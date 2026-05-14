import { getCacheManager } from '@/lib/federation/clients'
import { checkRateLimit } from '@/lib/webhooks/rate-limiter'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { webhookEvents } from '@phynd/db/schema'
import { validateWebhookSignature } from '@phynd/federation/webhooks'
import { createLogger } from '@phynd/logging'
import { GrantsService, createServiceContext } from '@phynd/services'
import { and, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('web:webhook:karafiel')

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000 // 5 minutes

interface KarafielWebhookPayload {
  event?: string
  type?: string
  event_type?: string
  event_id?: string
  data?: {
    grantApplicationId?: string
    awardedAmount?: string | null
    [key: string]: unknown
  }
  [key: string]: unknown
}

type Tx = Parameters<Parameters<typeof getDb>['transaction']>[0]

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.KARAFIEL_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  // 1) Rate limit by source IP.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { allowed, remaining } = await checkRateLimit(ip)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      {
        status: 429,
        headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' },
      },
    )
  }

  // 2) Signature + anti-replay checks.
  const timestampHeader = req.headers.get('x-webhook-timestamp')
  if (!timestampHeader) {
    return NextResponse.json({ error: 'Missing x-webhook-timestamp header' }, { status: 401 })
  }

  const eventAtMs = Date.parse(timestampHeader)
  if (Number.isNaN(eventAtMs)) {
    return NextResponse.json({ error: 'Invalid x-webhook-timestamp header' }, { status: 400 })
  }

  const ageMs = Date.now() - eventAtMs
  if (ageMs < 0 || ageMs > MAX_TIMESTAMP_AGE_MS) {
    return NextResponse.json({ error: 'Webhook timestamp expired' }, { status: 401 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-phyndcrm-signature') ?? ''
  if (!signature || !validateWebhookSignature(rawBody, signature, secret)) {
    logger.warn({ ip, hasSignature: Boolean(signature) }, 'rejected karafiel webhook signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // 3) Parse payload and provide a normalized event type.
  let payload: KarafielWebhookPayload
  try {
    payload = JSON.parse(rawBody) as KarafielWebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
  }

  const eventType =
    (typeof payload.event === 'string' ? payload.event.trim() : '') ||
    (typeof payload.type === 'string' ? payload.type.trim() : '') ||
    (typeof payload.event_type === 'string' ? payload.event_type.trim() : '')

  if (!eventType) {
    return NextResponse.json({ error: 'Missing event type' }, { status: 400 })
  }

  const eventId =
    typeof payload.event_id === 'string' && payload.event_id.trim()
      ? payload.event_id.trim()
      : undefined

  const db = getDb()

  if (eventId) {
    const prior = await db
      .select({ id: webhookEvents.id })
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.provider, 'karafiel'),
          sql`${webhookEvents.payload} ->> 'event_id' = ${eventId}`,
        ),
      )
      .limit(1)

    if (prior.length > 0) {
      return NextResponse.json(
        { status: 'duplicate', event_id: eventId },
        { headers: { 'X-RateLimit-Remaining': String(remaining) } },
      )
    }
  }

  try {
    await db.transaction(async (tx) => {
      const [whRow] = await tx
        .insert(webhookEvents)
        .values({
          provider: 'karafiel',
          eventType,
          payload: {
            ...payload,
            _received_at: new Date().toISOString(),
          },
          processedAt: new Date(),
        })
        .returning({ id: webhookEvents.id })

      const webhookEventId = whRow?.id ?? null

      if (eventType === 'grant.awarded') {
        await processGrantAward(payload, tx, webhookEventId)
      }
    })

    return NextResponse.json(
      { received: true, event_type: eventType },
      { headers: { 'X-RateLimit-Remaining': String(remaining) } },
    )
  } catch (error) {
    logger.error({ err: error, eventType }, 'karafiel webhook processing failed')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}

async function processGrantAward(
  payload: KarafielWebhookPayload,
  txDb: Tx,
  webhookEventId: string | null,
) {
  const data = payload.data
  if (!data || typeof data.grantApplicationId !== 'string' || !data.grantApplicationId.trim()) {
    return
  }

  const cache = getCacheManager()
  const ctx = createServiceContext(
    txDb,
    cache,
    {
      userId: 'service:karafiel-webhook',
      tenantId: DEFAULT_TENANT_ID,
      roles: ['service'],
      scopes: ['grants:write'],
      accessToken: '',
    },
    DEFAULT_TENANT_ID,
  )

  const grantsService = new GrantsService(ctx)
  const grantApplicationId = data.grantApplicationId

  try {
    const awarded =
      data.awardedAmount === undefined || data.awardedAmount === null
        ? undefined
        : String(data.awardedAmount)

    const updated = await grantsService.markAwarded(grantApplicationId, awarded)
    if (!updated) {
      logger.warn(
        { grantApplicationId, webhookEventId },
        'grant.awarded had no matching application',
      )
    }
  } catch (error) {
    logger.warn(
      { err: error, grantApplicationId, webhookEventId },
      'Unable to apply grant.awarded from Karafiel webhook',
    )
  }
}

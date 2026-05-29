import { getCacheManager } from '@/lib/federation/clients'
import {
  createWebhookEngagementsService,
  resolveTenantIdForWebhook,
} from '@/lib/webhooks/engagement-writer'
import { checkRateLimit } from '@/lib/webhooks/rate-limiter'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { webhookEvents } from '@phynd/db/schema'
import { validateWebhookSignature } from '@phynd/federation/webhooks'
import { createLogger } from '@phynd/logging'
import { GrantsService, createServiceContext, karafielPortalStatus } from '@phynd/services'
import { and, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('web:webhook:karafiel')

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000 // 5 minutes

interface KarafielWebhookPayload {
  event?: string
  type?: string
  event_type?: string
  event_id?: string
  engagement_id?: string
  data?: {
    grantApplicationId?: string
    awardedAmount?: string | null
    engagementId?: string
    engagement_id?: string
    invoiceId?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

async function checkKarafielRateLimit(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { allowed, remaining } = await checkRateLimit(ip)
  if (!allowed) {
    return {
      ip,
      remaining,
      response: NextResponse.json(
        { error: 'Rate limit exceeded' },
        {
          status: 429,
          headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' },
        },
      ),
    }
  }

  return { ip, remaining, response: null }
}

function validateKarafielTimestamp(req: Request): NextResponse | null {
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

  return null
}

function validateKarafielSignature(
  rawBody: string,
  signature: string,
  secret: string,
  ip: string,
): NextResponse | null {
  if (!signature || !validateWebhookSignature(rawBody, signature, secret)) {
    logger.warn({ ip, hasSignature: Boolean(signature) }, 'rejected karafiel webhook signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  return null
}

function parseKarafielPayload(rawBody: string): KarafielWebhookPayload | NextResponse {
  try {
    const payload = JSON.parse(rawBody) as KarafielWebhookPayload
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
    }
    return payload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
}

function karafielEventType(payload: KarafielWebhookPayload): string {
  const eventType =
    (typeof payload.event === 'string' ? payload.event.trim() : '') ||
    (typeof payload.type === 'string' ? payload.type.trim() : '') ||
    (typeof payload.event_type === 'string' ? payload.event_type.trim() : '')
  return eventType
}

function karafielEventId(payload: KarafielWebhookPayload): string | undefined {
  return typeof payload.event_id === 'string' && payload.event_id.trim()
    ? payload.event_id.trim()
    : undefined
}

async function existingKarafielEvent(db: Db, eventId: string | undefined): Promise<boolean> {
  if (!eventId) return false
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

  return prior.length > 0
}

async function recordKarafielEngagementEvent(
  req: Request,
  payload: KarafielWebhookPayload,
  eventType: string,
): Promise<void> {
  const engagementId =
    (typeof payload.engagement_id === 'string' ? payload.engagement_id : undefined) ??
    (typeof payload.data?.engagementId === 'string' ? payload.data.engagementId : undefined) ??
    (typeof payload.data?.engagement_id === 'string' ? payload.data.engagement_id : undefined)

  if (!engagementId) return

  const complianceEvents = new Set([
    'cfdi.stamped',
    'cfdi_stamped',
    'nom151.stamped',
    'nom151_stamped',
    'nom_151_stamped',
  ])
  if (!complianceEvents.has(eventType.toLowerCase())) return

  try {
    const tenantId = resolveTenantIdForWebhook(req)
    const db = getDb(tenantId)
    const service = createWebhookEngagementsService(db, 'karafiel', tenantId)
    const externalId =
      karafielEventId(payload) ??
      (typeof payload.data?.invoiceId === 'string' ? payload.data.invoiceId : engagementId)

    await service.recordMilestoneWithCanonicalAlias({
      engagementId,
      source: 'karafiel',
      nativeEventName: eventType,
      externalId,
      status: karafielPortalStatus(eventType),
      message: `Karafiel: ${eventType}`,
      metadata: { karafiel_event: eventType, event_id: karafielEventId(payload) },
    })
  } catch (err) {
    logger.warn({ err, eventType, engagementId }, 'karafiel engagement event failed (non-blocking)')
  }
}

async function writeKarafielEvent(
  db: Db,
  payload: KarafielWebhookPayload,
  eventType: string,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx: Tx) => {
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

  await recordKarafielEngagementEvent(req, payload, eventType)
}

async function handleKarafielPayload(
  req: Request,
  rawBody: string,
  remaining: number,
): Promise<NextResponse> {
  const payload = parseKarafielPayload(rawBody)
  if (payload instanceof NextResponse) return payload

  const eventType = karafielEventType(payload)
  if (!eventType) {
    return NextResponse.json({ error: 'Missing event type' }, { status: 400 })
  }

  const eventId = karafielEventId(payload)
  const db = getDb()
  if (eventId) {
    if (await existingKarafielEvent(db, eventId)) {
      return NextResponse.json(
        { status: 'duplicate', event_id: eventId },
        { headers: { 'X-RateLimit-Remaining': String(remaining) } },
      )
    }
  }

  try {
    await writeKarafielEvent(db, payload, eventType, req)
    return NextResponse.json(
      { received: true, event_type: eventType },
      { headers: { 'X-RateLimit-Remaining': String(remaining) } },
    )
  } catch (error) {
    logger.error({ err: error, eventType }, 'karafiel webhook processing failed')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.KARAFIEL_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  const { ip, remaining, response } = await checkKarafielRateLimit(req)
  if (response) return response

  const timestampError = validateKarafielTimestamp(req)
  if (timestampError) return timestampError

  const rawBody = await req.text()
  const signature = req.headers.get('x-phyndcrm-signature') ?? ''
  const signatureError = validateKarafielSignature(rawBody, signature, secret, ip)
  if (signatureError) return signatureError

  return handleKarafielPayload(req, rawBody, remaining)
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
    txDb as unknown as Db,
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

import { resolveTenantIdForWebhook } from '@/lib/webhooks/engagement-writer'
import { parseSignedWebhookRequest } from '@/lib/webhooks/handler'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import {
  SUPPRESSION_CHANNELS,
  type SuppressionChannel,
  SuppressionService,
  createServiceContext,
} from '@phynd/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:suppression-check')

// Cross-product suppression check. Contract: docs/CONSENT_API.md.
//
// Expected payload:
//   { identifier: string, channel?: 'all' | 'email' | 'sms' | 'whatsapp' }
//
// Response: { suppressed, entries: [{ channel, reason, source, created_at }] }
//
// Secret: PHYND_CONSENT_EVENTS_SECRET.
export async function POST(req: Request) {
  const secret = process.env.PHYND_CONSENT_EVENTS_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Consent events secret not configured' }, { status: 503 })
  }

  const parsed = await parseSignedWebhookRequest(req, secret)
  if (!parsed.ok) {
    return parsed.response
  }

  const identifier = parsed.payload.identifier as string | undefined
  const channel = (parsed.payload.channel as string | undefined) ?? 'all'

  if (!identifier) {
    return NextResponse.json({ error: 'Missing identifier' }, { status: 400 })
  }
  if (!(SUPPRESSION_CHANNELS as readonly string[]).includes(channel)) {
    return NextResponse.json({ error: `Invalid channel: ${channel}` }, { status: 400 })
  }

  try {
    const tenantId = resolveTenantIdForWebhook(req)
    const db = getDb(tenantId)
    const service = new SuppressionService(
      createServiceContext(db, {} as never, {
        userId: 'service:suppression-check',
        tenantId,
        roles: ['service'],
        scopes: ['consent:read'],
        accessToken: '',
      }),
    )

    const result = await service.check(identifier, channel as SuppressionChannel)

    return NextResponse.json(
      {
        suppressed: result.suppressed,
        entries: result.entries.map((entry) => ({
          channel: entry.channel,
          reason: entry.reason,
          source: entry.source,
          created_at: entry.createdAt.toISOString(),
        })),
      },
      { headers: { 'X-RateLimit-Remaining': String(parsed.remaining) } },
    )
  } catch (error) {
    logger.error({ err: error }, 'suppression check failed')
    return NextResponse.json({ error: 'Suppression check failed' }, { status: 500 })
  }
}

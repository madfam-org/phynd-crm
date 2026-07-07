import { resolveTenantIdForWebhook } from '@/lib/webhooks/engagement-writer'
import { parseSignedWebhookRequest } from '@/lib/webhooks/handler'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import {
  SUPPRESSION_CHANNELS,
  SUPPRESSION_REASONS,
  type SuppressionChannel,
  type SuppressionReason,
  SuppressionService,
  createServiceContext,
} from '@phynd/services'
import { ValidationError } from '@phynd/services/errors'
import { NextResponse } from 'next/server'

const logger = createLogger('web:suppression-add')

// Cross-product suppression-list add (idempotent). Suppression wins over any
// consent status. Contract: docs/CONSENT_API.md.
//
// Expected payload:
//   {
//     identifier: string,             // lowercase email or E.164 phone
//     channel?: 'all' | 'email' | 'sms' | 'whatsapp',   // default 'all'
//     reason: 'complaint' | 'hard_bounce' | 'unsubscribe' | 'manual' | 'legal_request',
//     source: string,                 // product adding the entry
//     evidence?: string,
//     metadata?: object
//   }
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

  const payload = parsed.payload
  const identifier = payload.identifier as string | undefined
  const reason = payload.reason as string | undefined
  const source = payload.source as string | undefined
  const channel = (payload.channel as string | undefined) ?? 'all'

  if (!identifier || !reason || !source) {
    return NextResponse.json({ error: 'Missing identifier, reason, or source' }, { status: 400 })
  }
  if (!(SUPPRESSION_REASONS as readonly string[]).includes(reason)) {
    return NextResponse.json({ error: `Invalid reason: ${reason}` }, { status: 400 })
  }
  if (!(SUPPRESSION_CHANNELS as readonly string[]).includes(channel)) {
    return NextResponse.json({ error: `Invalid channel: ${channel}` }, { status: 400 })
  }

  try {
    const tenantId = resolveTenantIdForWebhook(req)
    const db = getDb(tenantId)
    const service = new SuppressionService(
      createServiceContext(db, {} as never, {
        userId: `service:${source}`,
        tenantId,
        roles: ['service'],
        scopes: ['consent:write'],
        accessToken: '',
      }),
    )

    const result = await service.add({
      identifier,
      channel: channel as SuppressionChannel,
      reason: reason as SuppressionReason,
      source,
      evidence: payload.evidence as string | undefined,
      metadata: (payload.metadata as Record<string, unknown> | undefined) ?? undefined,
    })

    logger.info({ channel, reason, source, created: result.created }, 'suppression add processed')

    return NextResponse.json(
      {
        entry: {
          id: result.entry.id,
          identifier: result.entry.identifier,
          channel: result.entry.channel,
          reason: result.entry.reason,
        },
        created: result.created,
      },
      { headers: { 'X-RateLimit-Remaining': String(parsed.remaining) } },
    )
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    logger.error({ err: error }, 'suppression add failed')
    return NextResponse.json({ error: 'Suppression add failed' }, { status: 500 })
  }
}

import { resolveTenantIdForWebhook } from '@/lib/webhooks/engagement-writer'
import { parseSignedWebhookRequest } from '@/lib/webhooks/handler'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { ConsentService, createServiceContext, isConsentChannel } from '@phynd/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:consent-check')

// Cross-product consent + suppression check. Contract: docs/CONSENT_API.md.
//
// Expected payload:
//   { identifier: string, channel: 'email' | 'sms' | 'whatsapp' }
//
// Response: { identifier, channel, consent_status, suppressed,
//             suppression_reasons, permitted }
//
// `permitted` is true only when consent is granted AND not suppressed —
// suppression wins over any consent.
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

  const identifier =
    (parsed.payload.identifier as string | undefined) ??
    (parsed.payload.email as string | undefined)
  const channel = parsed.payload.channel as string | undefined

  if (!identifier || !channel || !isConsentChannel(channel)) {
    return NextResponse.json({ error: 'Missing identifier or invalid channel' }, { status: 400 })
  }

  try {
    const tenantId = resolveTenantIdForWebhook(req)
    const db = getDb(tenantId)
    const service = new ConsentService(
      createServiceContext(db, {} as never, {
        userId: 'service:consent-check',
        tenantId,
        roles: ['service'],
        scopes: ['consent:read'],
        accessToken: '',
      }),
    )

    const permission = await service.checkPermission(identifier, channel)

    return NextResponse.json(
      {
        identifier: permission.identifier,
        channel: permission.channel,
        consent_status: permission.consentStatus,
        suppressed: permission.suppressed,
        suppression_reasons: permission.suppressionReasons,
        permitted: permission.permitted,
      },
      { headers: { 'X-RateLimit-Remaining': String(parsed.remaining) } },
    )
  } catch (error) {
    logger.error({ err: error }, 'consent check failed')
    return NextResponse.json({ error: 'Consent check failed' }, { status: 500 })
  }
}

import { resolveTenantIdForWebhook } from '@/lib/webhooks/engagement-writer'
import { checkRateLimit } from '@/lib/webhooks/rate-limiter'
import { verifySvixSignature } from '@/lib/webhooks/svix'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import {
  CampaignEmailEventService,
  type ResendWebhookEvent,
  createServiceContext,
} from '@phynd/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:webhook-resend')

// Resend email event webhook (email.sent / delivered / delivery_delayed /
// opened / clicked / bounced / complained).
//
// - Signed with Svix headers (svix-id / svix-timestamp / svix-signature),
//   NOT the shared x-webhook-signature scheme — hence the dedicated
//   verification instead of `handleWebhook`.
// - Idempotent via the svix message id (stable across redeliveries).
// - Fan-out: campaign_email_events row, buyer signal for SKU campaigns
//   (opened/clicked/bounced/complained), suppression-list entry on
//   bounce/complaint.
//
// Secret: RESEND_WEBHOOK_SECRET (whsec_… signing secret from the Resend
// dashboard; placeholder until the endpoint is registered there).
export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Resend webhook secret not configured' }, { status: 503 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { allowed, remaining } = await checkRateLimit(ip)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' } },
    )
  }

  const body = await req.text()
  const verification = verifySvixSignature(
    body,
    {
      svixId: req.headers.get('svix-id'),
      svixTimestamp: req.headers.get('svix-timestamp'),
      svixSignature: req.headers.get('svix-signature'),
    },
    secret,
  )

  if (!verification.ok) {
    logger.warn({ reason: verification.reason }, 'resend webhook signature rejected')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: ResendWebhookEvent
  try {
    event = JSON.parse(body) as ResendWebhookEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  try {
    const tenantId = resolveTenantIdForWebhook(req)
    const db = getDb(tenantId)
    const service = new CampaignEmailEventService(
      createServiceContext(db, {} as never, {
        userId: 'service:resend-webhook',
        tenantId,
        roles: ['service'],
        scopes: ['campaigns:write'],
        accessToken: '',
      }),
    )

    const result = await service.ingestResendEvent(event, verification.messageId)
    logger.info(
      {
        type: event.type,
        handled: result.handled,
        deduplicated: result.deduplicated,
        campaignId: result.campaignId,
        suppressionAdded: result.suppressionAdded,
      },
      'resend event processed',
    )

    return NextResponse.json(
      { received: true },
      { headers: { 'X-RateLimit-Remaining': String(remaining) } },
    )
  } catch (error) {
    logger.error({ err: error }, 'resend webhook processing error')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}

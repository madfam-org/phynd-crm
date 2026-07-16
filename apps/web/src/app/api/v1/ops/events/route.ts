import {
  createWebhookServiceContext,
  resolveTenantIdForWebhook,
} from '@/lib/webhooks/engagement-writer'
import { parseSignedWebhookRequest } from '@/lib/webhooks/handler'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { OpsEventsService } from '@phynd/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:ops-events')

// Ops-events ingress — the CRM↔Ops↔Checkout feedback loop's phynd receiver.
//
// dhanam / enclii / pravara POST customer-level `madfam.ops.v1` events here
// (project_milestone_reached, usage_limit_approaching,
// physical_delivery_confirmed) with an HMAC-signed body. Unlike
// /api/v1/engagements/events, these are contact-scoped (no engagement_id), so
// the receiver resolves the subject to a contact, writes a timeline activity,
// and — rule-permitting — persists a pending upsell offer.
//
// Auth: raw-body HMAC-SHA256 in `x-webhook-signature` + `x-webhook-timestamp`
// (5-min replay window), via the shared parser. Secret: PHYND_OPS_EVENTS_SECRET
// — deliberately distinct from PHYND_ENGAGEMENT_EVENTS_SECRET so a rotation on
// one loop cannot deadlock the other. When unset, returns 503 (fail-closed).
//
// Idempotency: at-least-once delivery, exactly-once effect. The service dedups
// on the envelope `id`; a replay returns 200 { deduplicated: true }. An
// unresolvable subject returns 202 { skipped } and is NOT dedup-marked, so a
// retry after the contact lands still processes.
export async function POST(req: Request) {
  const secret = process.env.PHYND_OPS_EVENTS_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Ops events secret not configured' }, { status: 503 })
  }

  const parsed = await parseSignedWebhookRequest(req, secret)
  if (!parsed.ok) {
    return parsed.response
  }

  const { payload, remaining } = parsed
  const headers = { 'X-RateLimit-Remaining': String(remaining) }

  const tenantId = resolveTenantIdForWebhook(req)
  const service = new OpsEventsService(
    createWebhookServiceContext(getDb(tenantId), 'ops', tenantId),
  )

  try {
    const result = await service.ingest(payload)

    if (result.status === 'skipped') {
      logger.warn(
        { reason: result.reason, eventType: payload.event_type, dedupKey: payload.dedup_key },
        'ops event skipped',
      )
      return NextResponse.json(
        { received: true, skipped: true, reason: result.reason },
        { status: 202, headers },
      )
    }

    logger.info(
      {
        eventType: payload.event_type,
        contactId: result.contactId,
        deduplicated: result.status === 'duplicate',
        offerId: result.status === 'accepted' ? result.offerId : undefined,
      },
      result.status === 'duplicate' ? 'ops event deduplicated' : 'ops event recorded',
    )

    return NextResponse.json(
      {
        received: true,
        deduplicated: result.status === 'duplicate',
        contact_id: result.contactId,
        ...(result.status === 'accepted'
          ? { activity_id: result.activityId, offer_id: result.offerId }
          : {}),
      },
      { headers },
    )
  } catch (err) {
    logger.error({ err, eventType: payload.event_type }, 'ops event failed')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500, headers })
  }
}

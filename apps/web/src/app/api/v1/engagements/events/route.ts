import {
  createWebhookEngagementsService,
  createWebhookServiceContext,
  resolveTenantIdForWebhook,
} from '@/lib/webhooks/engagement-writer'
import { parseSignedWebhookRequest } from '@/lib/webhooks/handler'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { CotizaQuoteLifecycleService, isCotizaQuoteLifecycleEvent } from '@phynd/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:engagements-events')

// Unified engagement-event webhook. Any ecosystem service writing a
// project-status update for a tracked engagement posts here with an
// HMAC-signed payload. The dedup_key shape lets any caller make the
// write idempotent without coordination.
//
// Expected payload shape:
//   {
//     engagement_id: string,
//     source: 'pravara'|'selva'|'cotiza'|'karafiel'|'dhanam'|'system',
//     event_type: string,
//     status?: string,
//     message?: string,
//     timestamp?: string,
//     dedup_key?: string,
//     metadata?: Record<string, unknown>
//   }
//
// Cotiza quote-lifecycle events (`cotiza:quote_sent|quote_viewed|
// quote_approved|quote_rejected|quote_expired|quote_ordered`) may arrive
// WITHOUT engagement_id — they are resolved via external_references
// (provider 'cotiza') / contact_email and reflected onto the local quotes
// row by CotizaQuoteLifecycleService. Unresolvable Cotiza events return
// 202 { skipped: true } (idempotent skip, never a 500 for an unknown
// contact). Everything else keeps the generic contract: missing required
// fields are dropped silently with a 200.
//
// Secret: PHYND_ENGAGEMENT_EVENTS_SECRET. When unset, returns 503 to fail closed.
export async function POST(req: Request) {
  const secret = process.env.PHYND_ENGAGEMENT_EVENTS_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Engagement events secret not configured' }, { status: 503 })
  }

  const parsed = await parseSignedWebhookRequest(req, secret)
  if (!parsed.ok) {
    return parsed.response
  }

  const { payload, remaining } = parsed
  const headers = { 'X-RateLimit-Remaining': String(remaining) }

  if (isCotizaQuoteLifecycleEvent(payload)) {
    return handleCotizaQuoteLifecycle(req, payload, headers)
  }

  return handleGenericEngagementEvent(req, payload, headers)
}

async function handleCotizaQuoteLifecycle(
  req: Request,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
) {
  const eventType = payload.event_type as string
  const tenantId = resolveTenantIdForWebhook(req)
  const db = getDb(tenantId)
  const service = new CotizaQuoteLifecycleService(
    createWebhookServiceContext(db, 'cotiza', tenantId),
  )

  try {
    const result = await service.processWebhookPayload(payload)

    if (result.outcome === 'skipped') {
      logger.warn(
        { eventType, reason: result.reason, dedupKey: payload.dedup_key },
        'cotiza quote lifecycle event skipped',
      )
      return NextResponse.json(
        { received: true, skipped: true, reason: result.reason },
        { status: 202, headers },
      )
    }

    logger.info(
      {
        eventType,
        engagementId: result.engagementId,
        quoteId: result.quoteId,
        reflection: result.reflection,
        deduplicated: result.outcome === 'deduplicated',
        autoMaterializedEngagement: result.autoMaterializedEngagement,
        createdQuote: result.createdQuote,
      },
      result.outcome === 'deduplicated'
        ? 'cotiza quote lifecycle event deduplicated'
        : 'cotiza quote lifecycle event recorded',
    )

    return NextResponse.json(
      {
        received: true,
        deduplicated: result.outcome === 'deduplicated',
        engagement_id: result.engagementId,
        quote_id: result.quoteId,
        reflection: result.reflection,
      },
      { headers },
    )
  } catch (error) {
    logger.error({ err: error, eventType }, 'cotiza quote lifecycle event failed')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500, headers })
  }
}

async function handleGenericEngagementEvent(
  req: Request,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
) {
  const engagementId = payload.engagement_id as string | undefined
  const source = payload.source as string | undefined
  const eventType = payload.event_type as string | undefined

  if (!engagementId || !source || !eventType) {
    logger.warn({ payload }, 'engagement event missing required fields')
    return NextResponse.json({ received: true }, { headers })
  }

  const dedupKey =
    (payload.dedup_key as string | undefined) ??
    [source, eventType, payload.timestamp ?? ''].filter(Boolean).join(':')

  const tenantId = resolveTenantIdForWebhook(req)
  const db = getDb(tenantId)
  const service = createWebhookEngagementsService(db, source, tenantId)

  try {
    const result = await service.recordEvent({
      engagementId,
      source,
      eventType,
      status: payload.status as string | undefined,
      message: payload.message as string | undefined,
      metadata: (payload.metadata as Record<string, unknown> | undefined) ?? {},
      dedupKey,
    })
    logger.info(
      { engagementId, source, eventType, deduplicated: result.deduplicated },
      result.deduplicated ? 'engagement event deduplicated' : 'engagement event recorded',
    )
    return NextResponse.json({ received: true }, { headers })
  } catch (err) {
    logger.error({ err, engagementId, source, eventType }, 'engagement event failed')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500, headers })
  }
}

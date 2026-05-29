/**
 * Outbound webhook emitter for Cotiza's engagement projection.
 *
 * Fires whenever an engagement is created/updated/archived in PhyndCRM so
 * Cotiza's projection stays in sync without relying on the
 * auto-materialize-on-quote-create fallback.
 *
 * Counterpart controller on Cotiza side:
 *   apps/api/src/modules/engagements/webhooks/phyndcrm-engagements-webhook.controller.ts
 * which reads the shared secret from env `PHYNDCRM_INBOUND_SECRET`. On this
 * side the same shared secret is read from `PHYNDCRM_OUTBOUND_SECRET` — the
 * asymmetric naming matches the existing ecosystem pattern (inbound secret
 * on receiver, outbound secret on emitter, same value).
 *
 * Contract:
 *   POST ${COTIZA_API_URL}/api/v1/webhooks/phyndcrm/engagements
 *   Header: x-phyndcrm-signature: <hex of HMAC-SHA256(body, secret)>
 *   Body:   { engagement_id, event_type, tenant_id, timestamp, data? }
 *
 * Delivery semantics: fire-and-forget. Errors are logged, never thrown.
 * Cotiza being offline must never break a PhyndCRM write. Idempotency is
 * the receiver's responsibility (dedup on engagement_id + event_type).
 */

import crypto from 'node:crypto'
import { isOutboundUrlAllowed } from '@phynd/config/outbound-guard'
import { createLogger } from '@phynd/logging'

const logger = createLogger('services:cotiza-engagement-emitter')

export type CotizaEngagementEventType =
  | 'engagement.created'
  | 'engagement.updated'
  | 'engagement.archived'

export interface CotizaEngagementEvent {
  engagementId: string
  eventType: CotizaEngagementEventType
  tenantId: string
  data?: {
    project_name?: string | null
    status?: string | null
    contact_id?: string | null
    [key: string]: unknown
  }
}

interface OutboundPayload {
  engagement_id: string
  event_type: CotizaEngagementEventType
  tenant_id: string
  timestamp: string
  data?: CotizaEngagementEvent['data']
}

interface EmitterConfig {
  cotizaApiUrl: string
  secret: string
  timeoutMs: number
}

let warnedOnce = false

function loadConfig(): EmitterConfig | null {
  const cotizaApiUrl = process.env.COTIZA_API_URL
  const secret = process.env.PHYNDCRM_OUTBOUND_SECRET
  const timeoutMs = Number(process.env.COTIZA_WEBHOOK_TIMEOUT ?? 10_000)

  if (!cotizaApiUrl || !secret) {
    if (!warnedOnce) {
      logger.warn(
        { hasUrl: Boolean(cotizaApiUrl), hasSecret: Boolean(secret) },
        'COTIZA_API_URL or PHYNDCRM_OUTBOUND_SECRET not set — Cotiza engagement emitter disabled',
      )
      warnedOnce = true
    }
    return null
  }

  return { cotizaApiUrl, secret, timeoutMs }
}

/**
 * POST an engagement lifecycle event to Cotiza's inbound receiver.
 * Never throws. Resolves when the HTTP call settles (ok or not) or is
 * skipped due to missing env.
 */
export async function emitCotizaEngagementEvent(event: CotizaEngagementEvent): Promise<void> {
  const config = loadConfig()
  if (!config) return

  const payload: OutboundPayload = {
    engagement_id: event.engagementId,
    event_type: event.eventType,
    tenant_id: event.tenantId,
    timestamp: new Date().toISOString(),
    data: event.data,
  }

  const body = JSON.stringify(payload)
  const signature = crypto.createHmac('sha256', config.secret).update(body).digest('hex')

  const url = `${config.cotizaApiUrl.replace(/\/$/, '')}/api/v1/webhooks/phyndcrm/engagements`

  if (!isOutboundUrlAllowed(url, 'cotiza-engagement')) {
    logger.warn(
      { engagementId: event.engagementId, eventType: event.eventType, url },
      'Blocked Cotiza engagement dispatch: staging cannot call production Cotiza',
    )
    return
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-phyndcrm-signature': signature,
      },
      body,
      signal: AbortSignal.timeout(config.timeoutMs),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '<unreadable>')
      logger.warn(
        {
          engagementId: event.engagementId,
          eventType: event.eventType,
          status: response.status,
          body: text.slice(0, 500),
        },
        'Cotiza engagement webhook returned non-2xx',
      )
      return
    }

    logger.debug(
      { engagementId: event.engagementId, eventType: event.eventType },
      'Cotiza engagement webhook delivered',
    )
  } catch (err) {
    logger.warn(
      {
        engagementId: event.engagementId,
        eventType: event.eventType,
        error: err instanceof Error ? err.message : String(err),
      },
      'Cotiza engagement webhook dispatch failed (swallowed)',
    )
  }
}

/**
 * Fire-and-forget wrapper: dispatches on next tick, caller never awaits
 * or sees a rejection. Use from inside service methods that must not be
 * slowed or broken by Cotiza availability.
 */
export function dispatchCotizaEngagementEvent(event: CotizaEngagementEvent): void {
  setImmediate(() => {
    void emitCotizaEngagementEvent(event).catch((err) => {
      // Belt-and-suspenders: emitCotizaEngagementEvent already swallows.
      logger.error(
        {
          engagementId: event.engagementId,
          eventType: event.eventType,
          error: err instanceof Error ? err.message : String(err),
        },
        'Unexpected error escaped Cotiza engagement emitter',
      )
    })
  })
}

// Test-only: reset the "warned once" latch so unit tests can exercise the
// missing-env path deterministically.
export function __resetEmitterWarningLatchForTests(): void {
  warnedOnce = false
}

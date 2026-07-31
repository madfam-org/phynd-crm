/**
 * POST /api/v1/events/payment.refunded
 *
 * Receiver for HMAC-signed `payment.refunded` events from Dhanam's Bus A
 * egress (`EcosystemPaymentEventsService`, dhanam#704).
 *
 * ## Why this matters more than it looks
 *
 * PhyndCRM is the attribution leg of the revenue flywheel: the `conversions`
 * rows written by the `payment.succeeded` receiver are what Selva's
 * Thompson-sampling bandit consumes as **rewards**. Until now nothing reversed
 * them, so a refunded payment left its conversion standing — which means the
 * bandit kept crediting the source agent for revenue that had been given back,
 * and would learn to favour whatever channel produces refunds. An unreversed
 * refund does not merely overstate revenue; it actively trains the optimiser in
 * the wrong direction.
 *
 * This records a **reversal conversion** with a negative `value` rather than
 * deleting or mutating the original:
 *
 *   - The original conversion is a historical fact — it happened, and the
 *     ledger should say so.
 *   - Any reward already consumed by the bandit cannot be un-consumed; a
 *     compensating negative entry is the only honest correction.
 *   - Partial refunds work naturally, since the reversal carries its own
 *     amount rather than assuming the full original.
 *
 * Contract mirrors the `payment.succeeded` receiver exactly:
 *   - Header: `x-madfam-signature: t=<ts>,v1=<hex>`
 *   - Secret: `PHYND_CRM_EVENTS_SECRET` (+ `_PREVIOUS` during rotation)
 *   - Idempotent on `event.event_id`
 */

import { rotationSecrets, verifyMadfamSignature } from '@/lib/webhooks/madfam-signature'
import { getDb } from '@phynd/db'
import { conversions, leads, webhookEvents } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { and, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('api:v1:events:payment.refunded')
const PROBE_SOURCE = 'synthetic-probe'

interface EcosystemPaymentRefundedEvent {
  schema_version: '1'
  event_type?: string
  event_id: string
  provider: string
  subscription_id: string
  organization_id: string
  amount_minor: number
  currency: string
  occurred_at: string
  attribution?: {
    source_agent_id?: string
    campaign_id?: string
    referral_code?: string
    first_touch_at?: string
  }
  metadata?: Record<string, unknown>
}

const REQUIRED_FIELDS = [
  'event_id',
  'provider',
  'subscription_id',
  'organization_id',
  'amount_minor',
  'currency',
  'occurred_at',
] as const

function missingRequiredField(event: EcosystemPaymentRefundedEvent) {
  for (const required of REQUIRED_FIELDS) {
    const value = event[required]
    if (value === undefined || value === null || value === '') {
      return required
    }
  }

  return null
}

export async function POST(request: Request) {
  const secrets = rotationSecrets(
    process.env.PHYND_CRM_EVENTS_SECRET,
    process.env.PHYND_CRM_EVENTS_SECRET_PREVIOUS,
  )
  if (secrets.length === 0) {
    logger.warn('PHYND_CRM_EVENTS_SECRET not configured')
    return NextResponse.json({ error: 'secret not configured' }, { status: 503 })
  }

  const rawBody = await request.text()
  const sig = request.headers.get('x-madfam-signature')
  const verification = verifyMadfamSignature(rawBody, sig, secrets)
  if (!verification.ok) {
    logger.warn({ reason: verification.reason }, 'signature rejected')
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let event: EcosystemPaymentRefundedEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (event.schema_version !== '1') {
    return NextResponse.json(
      { error: `unsupported schema_version: ${event.schema_version}` },
      { status: 400 },
    )
  }
  const missingField = missingRequiredField(event)
  if (missingField) {
    return NextResponse.json({ error: `missing required field: ${missingField}` }, { status: 400 })
  }

  // A refund of zero is not a refund. Reject rather than writing a reversal
  // that reverses nothing — it would be indistinguishable from a real one in
  // the ledger while carrying no information.
  if (!Number.isFinite(event.amount_minor) || event.amount_minor <= 0) {
    return NextResponse.json(
      { error: 'amount_minor must be a positive integer' },
      { status: 400 },
    )
  }

  const db = getDb()

  // Idempotency — same lookup-then-write pattern as the succeeded receiver.
  const existing = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.provider, 'madfam-ecosystem'),
        sql`${webhookEvents.payload}->>'event_id' = ${event.event_id}`,
      ),
    )
    .limit(1)

  if (existing.length > 0) {
    return NextResponse.json({
      received: true,
      duplicate: true,
      event_id: event.event_id,
    })
  }

  const wh = await db
    .insert(webhookEvents)
    .values({
      provider: 'madfam-ecosystem',
      eventType: 'payment.refunded',
      payload: event as unknown as Record<string, unknown>,
      processedAt: new Date(),
    })
    .returning({ id: webhookEvents.id })
  const webhookEvent = wh[0]

  if (!webhookEvent) {
    logger.error({ event_id: event.event_id }, 'webhook event insert returned no row')
    return NextResponse.json({ error: 'failed to record webhook event' }, { status: 500 })
  }

  const probeLead = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.source, PROBE_SOURCE))
    .limit(1)

  let conversionId: string | null = null
  const lead = probeLead[0]
  if (lead) {
    // Negative value: this is a compensating entry against the original
    // conversion, not a replacement for it.
    const amountMajor = `-${(event.amount_minor / 100).toFixed(2)}`
    const inserted = await db
      .insert(conversions)
      .values({
        type: 'ecosystem_refund',
        leadId: lead.id,
        value: amountMajor,
        metadata: {
          event_id: event.event_id,
          webhook_event_id: webhookEvent.id,
          provider: event.provider,
          currency: event.currency,
          // Kept positive here so the magnitude of the refund is readable
          // without unpicking the sign convention on `value`.
          refunded_amount_minor: event.amount_minor,
          subscription_id: event.subscription_id,
          organization_id: event.organization_id,
          source_agent_id: event.attribution?.source_agent_id ?? null,
          campaign_id: event.attribution?.campaign_id ?? null,
          referral_code: event.attribution?.referral_code ?? null,
          reverses: 'ecosystem_payment',
        },
      })
      .returning({ id: conversions.id })
    const conversion = inserted[0]
    if (!conversion) {
      logger.error({ event_id: event.event_id, lead_id: lead.id }, 'reversal insert returned no row')
      return NextResponse.json({ error: 'failed to record reversal' }, { status: 500 })
    }

    conversionId = conversion.id
    logger.info(
      { event_id: event.event_id, lead_id: lead.id, conversion_id: conversionId },
      'ecosystem refund recorded as reversal conversion',
    )
  } else {
    logger.info(
      { event_id: event.event_id },
      'no probe lead found — refund recorded without attribution binding',
    )
  }

  return NextResponse.json(
    {
      received: true,
      event_id: event.event_id,
      webhook_event_id: webhookEvent.id,
      conversion_id: conversionId,
    },
    { status: 201 },
  )
}

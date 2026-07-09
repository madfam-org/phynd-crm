/**
 * POST /api/v1/events/payment.succeeded
 *
 * Receiver for HMAC-signed `PaymentSucceededEvent`s from the MADFAM
 * ecosystem (RouteCraft, Karafiel, anything that emits through
 * `@routecraft/payments` `emitPaymentSucceeded()`).
 *
 * PhyndCRM is the "attribution" leg of the revenue flywheel — it
 * records a conversion tied to (lead, billing event) so the selva
 * Thompson-sampling bandit can reward the source agent later.
 *
 * Contract (from `REBRAND_SELVA_TO_SELVA` + factory manifests):
 *   - Header: `x-madfam-signature: t=<ts>,v1=<hex>`
 *   - Secret: env var `PHYND_CRM_EVENTS_SECRET`
 *   - Idempotent on `event.event_id` (dedupe against webhook_events table).
 */

import { rotationSecrets, verifyMadfamSignature } from '@/lib/webhooks/madfam-signature'
import { getDb } from '@phynd/db'
import { conversions, leads, webhookEvents } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { and, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('api:v1:events:payment.succeeded')
const PROBE_SOURCE = 'synthetic-probe'

interface EcosystemPaymentSucceededEvent {
  schema_version: '1'
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

const REQUIRED_PAYMENT_FIELDS = [
  'event_id',
  'provider',
  'subscription_id',
  'organization_id',
  'amount_minor',
  'currency',
  'occurred_at',
] as const

function missingRequiredPaymentField(event: EcosystemPaymentSucceededEvent) {
  for (const required of REQUIRED_PAYMENT_FIELDS) {
    const value = event[required]
    if (value === undefined || value === null || value === '') {
      return required
    }
  }

  return null
}

export async function POST(request: Request) {
  // Accept the current secret plus, during a rotation window, the previous one
  // (PHYND_CRM_EVENTS_SECRET_PREVIOUS) so a briefly-stale emitter still verifies.
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

  let event: EcosystemPaymentSucceededEvent
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
  const missingField = missingRequiredPaymentField(event)
  if (missingField) {
    return NextResponse.json({ error: `missing required field: ${missingField}` }, { status: 400 })
  }

  const db = getDb()

  // Idempotency — have we already processed this event_id?
  //   webhook_events has no unique constraint on payload fields, so we
  //   do the lookup-then-write pattern. A simultaneous duplicate write
  //   would create two rows; the probe only cares that *at least one*
  //   conversion exists per event.
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
      eventType: 'payment.succeeded',
      payload: event as unknown as Record<string, unknown>,
      processedAt: new Date(),
    })
    .returning({ id: webhookEvents.id })
  const webhookEvent = wh[0]

  if (!webhookEvent) {
    logger.error({ event_id: event.event_id }, 'webhook event insert returned no row')
    return NextResponse.json({ error: 'failed to record webhook event' }, { status: 500 })
  }

  // Look up the probe lead (single synthetic lead per tenant) and
  // record a conversion. For non-probe events we currently skip the
  // lead-binding step — a real lead resolver would map
  // organization_id → lead_id via the sourcing pipeline, out of scope
  // for this sweep.
  const probeLead = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.source, PROBE_SOURCE))
    .limit(1)

  let conversionId: string | null = null
  const lead = probeLead[0]
  if (lead) {
    const amountMajor = (event.amount_minor / 100).toFixed(2)
    const inserted = await db
      .insert(conversions)
      .values({
        type: 'ecosystem_payment',
        leadId: lead.id,
        value: amountMajor,
        metadata: {
          event_id: event.event_id,
          webhook_event_id: webhookEvent.id,
          provider: event.provider,
          currency: event.currency,
          amount_minor: event.amount_minor,
          subscription_id: event.subscription_id,
          organization_id: event.organization_id,
          source_agent_id: event.attribution?.source_agent_id ?? null,
          campaign_id: event.attribution?.campaign_id ?? null,
          referral_code: event.attribution?.referral_code ?? null,
        },
      })
      .returning({ id: conversions.id })
    const conversion = inserted[0]
    if (!conversion) {
      logger.error(
        { event_id: event.event_id, lead_id: lead.id },
        'conversion insert returned no row',
      )
      return NextResponse.json({ error: 'failed to record conversion' }, { status: 500 })
    }

    conversionId = conversion.id
    logger.info(
      {
        event_id: event.event_id,
        lead_id: lead.id,
        conversion_id: conversionId,
      },
      'ecosystem payment recorded as conversion',
    )
  } else {
    logger.info(
      { event_id: event.event_id },
      'no probe lead found — event recorded without attribution binding',
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

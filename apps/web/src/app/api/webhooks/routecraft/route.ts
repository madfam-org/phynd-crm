import { checkRateLimit } from '@/lib/webhooks/rate-limiter'
import { getDb } from '@phynd/db'
import { contacts, conversions, webhookEvents } from '@phynd/db/schema'
import { validateMadfamSignature } from '@phynd/federation'
import { createLogger } from '@phynd/logging'
import { and, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('web:webhook:routecraft')

/**
 * Inbound receiver for `@routecraft/payments`'s `emitPaymentSucceeded`.
 *
 * Signature contract (matches the RouteCraft emitter + probe + zavlo
 * MercadoPago):
 *   - Header: `x-madfam-signature: t=<unix-seconds>,v1=<hex-hmac-sha256>`
 *   - HMAC input: `"${ts}.${raw-body}"`
 *   - Secret: `PHYND_CRM_EVENTS_SECRET`
 *   - Replay window: 5 minutes.
 *
 * Flow:
 *   1. Rate-limit (shared redis sliding window).
 *   2. Verify signature.
 *   3. Parse + shape-check the payload.
 *   4. Skip with 200 if we've already seen this event_id (idempotency).
 *   5. Find the contact via `externalJanuaId` = `attribution.source_agent_id`
 *      if possible; otherwise record a tenant-wide "unlinked" conversion.
 *   6. Insert a `conversions` row + a `webhook_events` audit row.
 *
 * The receiver writes to `conversions.metadata` rather than introducing
 * a new schema so no migration is required for this wire-up.
 */

interface PaymentSucceededAttribution {
  source_agent_id?: string
  campaign_id?: string
  referral_code?: string
  first_touch_at?: string
}

interface PaymentSucceededEvent {
  schema_version: '1'
  event_id: string
  provider: string
  subscription_id: string
  organization_id: string
  amount_minor: number
  currency: string
  occurred_at: string
  attribution?: PaymentSucceededAttribution
  metadata?: Record<string, unknown>
}

type ReceiveResult =
  | { status: 'recorded'; conversion_id: string; contact_id: string | null }
  | { status: 'duplicate'; event_id: string }

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.PHYND_CRM_EVENTS_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { allowed, remaining } = await checkRateLimit(ip)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' } },
    )
  }

  const rawBody = await req.text()
  const sigResult = validateMadfamSignature(rawBody, req.headers.get('x-madfam-signature'), secret)
  if (!sigResult.ok) {
    logger.warn({ reason: sigResult.reason }, 'rejected routecraft webhook')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: PaymentSucceededEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const shapeError = validateEventShape(event)
  if (shapeError) {
    return NextResponse.json({ error: shapeError }, { status: 400 })
  }

  try {
    const result = await recordPaymentEvent(event)
    return NextResponse.json(
      { received: true, ...result },
      { headers: { 'X-RateLimit-Remaining': String(remaining) } },
    )
  } catch (err) {
    logger.error({ err, event_id: event.event_id }, 'routecraft webhook processing failed')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}

function validateEventShape(event: PaymentSucceededEvent): string | null {
  if (event.schema_version !== '1') return `unsupported schema_version: ${event.schema_version}`
  const required: (keyof PaymentSucceededEvent)[] = [
    'event_id',
    'provider',
    'subscription_id',
    'organization_id',
    'amount_minor',
    'currency',
    'occurred_at',
  ]
  for (const field of required) {
    const value = event[field]
    if (value === undefined || value === null || value === '') return `missing field: ${field}`
  }
  if (!Number.isFinite(event.amount_minor) || event.amount_minor < 0) {
    return 'amount_minor must be a non-negative number'
  }
  return null
}

async function recordPaymentEvent(event: PaymentSucceededEvent): Promise<ReceiveResult> {
  const db = getDb()

  // Idempotency — bail out cleanly if we've seen this event_id before.
  const prior = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.provider, 'routecraft'),
        sql`${webhookEvents.payload} ->> 'event_id' = ${event.event_id}`,
      ),
    )
    .limit(1)
  if (prior.length > 0) {
    return { status: 'duplicate', event_id: event.event_id }
  }

  const contactId = await resolveContactId(event.attribution?.source_agent_id)

  const valueMajor = (event.amount_minor / 100).toFixed(2)

  return await db.transaction(async (tx) => {
    const [wh] = await tx
      .insert(webhookEvents)
      .values({
        provider: 'routecraft',
        eventType: 'payment_succeeded',
        payload: event as unknown as Record<string, unknown>,
        processedAt: new Date(),
      })
      .returning({ id: webhookEvents.id })

    const [conversion] = await tx
      .insert(conversions)
      .values({
        type: 'ecosystem_payment_succeeded',
        contactId,
        value: valueMajor,
        metadata: {
          event_id: event.event_id,
          provider: event.provider,
          subscription_id: event.subscription_id,
          organization_id: event.organization_id,
          amount_minor: event.amount_minor,
          currency: event.currency,
          occurred_at: event.occurred_at,
          attribution: event.attribution ?? null,
          source_metadata: event.metadata ?? null,
          webhook_event_id: wh?.id ?? null,
        },
      })
      .returning({ id: conversions.id })

    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return { status: 'recorded', conversion_id: conversion!.id, contact_id: contactId }
  })
}

async function resolveContactId(sourceAgentId: string | undefined): Promise<string | null> {
  if (!sourceAgentId) return null
  const db = getDb()
  try {
    const [row] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.externalJanuaId, sourceAgentId))
      .limit(1)
    return row?.id ?? null
  } catch {
    return null
  }
}

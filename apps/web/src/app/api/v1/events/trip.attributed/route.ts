/**
 * POST /api/v1/events/trip.attributed
 *
 * Receiver for HMAC-signed `trip.attributed` events from RouteCraft.
 *
 * This is the PhyndCRM replacement for RouteCraft's TwentyCRM trip-attribution
 * sync (owner decision 2026-07-08: PhyndCRM is the sole ecosystem CRM). When a
 * RouteCraft trip is scored / converts, RouteCraft emits the trip's attribution
 * here so PhyndCRM owns the attribution ledger — mirroring the
 * `payment.succeeded` receiver in this same namespace.
 *
 * Contract (same envelope family as `emitPaymentSucceeded`):
 *   - Header: `x-madfam-signature: t=<ts>,v1=<hex>`
 *   - HMAC input: `"${ts}.${raw-body}"`
 *   - Secret: env var `PHYND_CRM_EVENTS_SECRET`
 *   - Idempotent on `event.event_id` (dedupe against webhook_events).
 *
 * A trip is recorded as a `conversions` row (`type = 'trip_attributed'`) bound
 * to the crediting contact/campaign when resolvable, with the full trip payload
 * in `metadata`. No migration is required — reuses the conversions ledger.
 */

import { verifyMadfamSignature } from '@/lib/webhooks/madfam-signature'
import { campaigns, contacts, conversions, getDb, webhookEvents } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { and, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('api:v1:events:trip.attributed')

interface TripAttributedEvent {
  schema_version: '1'
  event_id: string
  provider: string
  trip_id: string
  trip_name?: string
  organization_id?: string
  cities?: string[]
  start_date?: string
  end_date?: string
  total_score?: number
  business_score?: number
  events?: Array<{ name: string; city: string; date: string; category: string }>
  estimated_cost?: number
  actual_cost?: number
  pipeline_value?: number
  deals_created?: string[]
  meetings_held?: number
  attribution?: {
    source_agent_id?: string
    campaign_id?: string
    referral_code?: string
    first_touch_at?: string
  }
  occurred_at: string
  metadata?: Record<string, unknown>
}

const REQUIRED_FIELDS = ['event_id', 'provider', 'trip_id', 'occurred_at'] as const

function missingRequiredField(event: TripAttributedEvent) {
  for (const required of REQUIRED_FIELDS) {
    const value = event[required]
    if (value === undefined || value === null || value === '') {
      return required
    }
  }
  return null
}

export async function POST(request: Request) {
  const secret = process.env.PHYND_CRM_EVENTS_SECRET
  if (!secret) {
    logger.warn('PHYND_CRM_EVENTS_SECRET not configured')
    return NextResponse.json({ error: 'secret not configured' }, { status: 503 })
  }

  const rawBody = await request.text()
  const sig = request.headers.get('x-madfam-signature')
  const verification = verifyMadfamSignature(rawBody, sig, secret)
  if (!verification.ok) {
    logger.warn({ reason: verification.reason }, 'signature rejected')
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let event: TripAttributedEvent
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
  if (
    event.pipeline_value !== undefined &&
    (!Number.isFinite(event.pipeline_value) || event.pipeline_value < 0)
  ) {
    return NextResponse.json(
      { error: 'pipeline_value must be a non-negative number' },
      { status: 400 },
    )
  }

  const db = getDb()

  // Idempotency — bail out cleanly if we've already processed this event_id.
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
    return NextResponse.json({ received: true, duplicate: true, event_id: event.event_id })
  }

  const contactId = await resolveContactId(db, event.attribution?.source_agent_id)
  const campaignId = await resolveCampaignId(db, event.attribution?.campaign_id)
  const value = event.pipeline_value !== undefined ? event.pipeline_value.toFixed(2) : null

  return await db.transaction(async (tx) => {
    const wh = await tx
      .insert(webhookEvents)
      .values({
        provider: 'madfam-ecosystem',
        eventType: 'trip.attributed',
        payload: event as unknown as Record<string, unknown>,
        processedAt: new Date(),
      })
      .returning({ id: webhookEvents.id })
    const webhookEvent = wh[0]

    const inserted = await tx
      .insert(conversions)
      .values({
        type: 'trip_attributed',
        contactId,
        campaignId,
        value,
        metadata: {
          event_id: event.event_id,
          webhook_event_id: webhookEvent?.id ?? null,
          provider: event.provider,
          trip_id: event.trip_id,
          trip_name: event.trip_name ?? null,
          organization_id: event.organization_id ?? null,
          cities: event.cities ?? null,
          start_date: event.start_date ?? null,
          end_date: event.end_date ?? null,
          total_score: event.total_score ?? null,
          business_score: event.business_score ?? null,
          events: event.events ?? null,
          estimated_cost: event.estimated_cost ?? null,
          actual_cost: event.actual_cost ?? null,
          pipeline_value: event.pipeline_value ?? null,
          deals_created: event.deals_created ?? null,
          meetings_held: event.meetings_held ?? null,
          attribution: event.attribution ?? null,
          occurred_at: event.occurred_at,
          source_metadata: event.metadata ?? null,
        },
      })
      .returning({ id: conversions.id })
    const conversion = inserted[0]

    logger.info(
      { event_id: event.event_id, trip_id: event.trip_id, conversion_id: conversion?.id ?? null },
      'routecraft trip attribution recorded as conversion',
    )

    return NextResponse.json(
      {
        received: true,
        event_id: event.event_id,
        webhook_event_id: webhookEvent?.id ?? null,
        conversion_id: conversion?.id ?? null,
      },
      { status: 201 },
    )
  })
}

async function resolveContactId(
  db: ReturnType<typeof getDb>,
  sourceAgentId: string | undefined,
): Promise<string | null> {
  if (!sourceAgentId) return null
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

async function resolveCampaignId(
  db: ReturnType<typeof getDb>,
  utmCampaign: string | undefined,
): Promise<string | null> {
  if (!utmCampaign) return null
  try {
    const [row] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.utmCampaign, utmCampaign))
      .orderBy(campaigns.createdAt)
      .limit(1)
    return row?.id ?? null
  } catch {
    return null
  }
}

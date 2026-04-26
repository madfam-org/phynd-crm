/**
 * Inbound webhook receiver for Coforma Studio.
 *
 * Coforma emits 3 event types (see coforma-studio PR #56):
 *   - cab.member.joined        → mark contact as a CAB member
 *   - cab.member.exited        → unlink (or note exit reason)
 *   - cab.feedback.created     → log as activity (followup PR; v1 logs only)
 *
 * Signature contract (matches Coforma's PhyneCrmRelayService + the
 * RouteCraft / cotiza ecosystem convention):
 *   - Header: `x-madfam-signature: t=<unix-seconds>,v1=<hex-hmac-sha256>`
 *   - HMAC input: `"${ts}.${raw-body}"`
 *   - Secret: `COFORMA_WEBHOOK_SECRET`
 *   - Replay window: 5 minutes
 *
 * Tenant resolution:
 *   - Coforma sends `x-coforma-tenant-id`. PhyneCRM is single-tenant in
 *     Phase 1 (`tenantId='madfam'` hardcoded), so for now we just log
 *     the source tenant and write into the global tenant. Phase 3 will
 *     wire this through a `tenant_external_links` lookup.
 *
 * Idempotency:
 *   - Coforma sends `idempotency-key`. We store it on the
 *     `webhook_events` row and skip on duplicate. Mirrors the routecraft
 *     receiver pattern.
 */

import { contacts, webhookEvents } from '@phyne/db/schema'
import { validateMadfamSignature } from '@phyne/federation'
import { getDb } from '@phyne/db'
import { createLogger } from '@phyne/logging'
import { and, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { checkRateLimit } from '@/lib/webhooks/rate-limiter'

const logger = createLogger('web:webhook:coforma')

interface MemberJoinedPayload {
  membershipId: string
  cabId: string
  cabSlug: string
  userEmail: string
  userName: string | null
  company: string | null
  title: string | null
  phynecrmContactId: string | null
}

interface MemberExitedPayload {
  membershipId: string
  cabId: string
  exitedAt: string
  exitNote: string | null
  phynecrmContactId: string | null
}

interface FeedbackCreatedPayload {
  feedbackId: string
  cabId: string
  authorEmail: string
  type: string
  title: string
  body: string
  priority: string | null
  phynecrmContactId: string | null
}

type CoformaEvent =
  | { type: 'cab.member.joined'; data: MemberJoinedPayload }
  | { type: 'cab.member.exited'; data: MemberExitedPayload }
  | { type: 'cab.feedback.created'; data: FeedbackCreatedPayload }

type ReceiveResult =
  | { status: 'recorded'; event_type: string; contact_id: string | null; note?: string }
  | { status: 'duplicate'; idempotency_key: string }
  | { status: 'unhandled'; event_type: string }

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.COFORMA_WEBHOOK_SECRET
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
  const sigResult = validateMadfamSignature(
    rawBody,
    req.headers.get('x-madfam-signature'),
    secret,
  )
  if (!sigResult.ok) {
    logger.warn({ reason: sigResult.reason }, 'rejected coforma webhook')
    return NextResponse.json({ error: 'Invalid signature', reason: sigResult.reason }, { status: 401 })
  }

  let event: CoformaEvent
  try {
    event = JSON.parse(rawBody) as CoformaEvent
  } catch (err) {
    logger.warn({ err }, 'coforma webhook body not JSON')
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
  }

  if (!event || typeof event !== 'object' || !('type' in event) || !('data' in event)) {
    return NextResponse.json({ error: 'Missing type/data' }, { status: 400 })
  }

  const idempotencyKey = req.headers.get('idempotency-key') ?? ''
  const sourceTenant = req.headers.get('x-coforma-tenant-id') ?? 'unknown'
  const db = getDb()

  // Dedup via webhook_events. The cotiza pattern uses
  // `payload->>'event_id'`; we use the explicit Idempotency-Key header
  // because Coforma derives it deterministically per event-entity pair.
  if (idempotencyKey) {
    const existing = await db
      .select({ id: webhookEvents.id })
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.provider, 'coforma'),
          sql`${webhookEvents.payload}->>'idempotency_key' = ${idempotencyKey}`,
        ),
      )
      .limit(1)
    if (existing.length > 0) {
      const result: ReceiveResult = { status: 'duplicate', idempotency_key: idempotencyKey }
      return NextResponse.json(result, { headers: { 'X-RateLimit-Remaining': String(remaining) } })
    }
  }

  // Process event
  let result: ReceiveResult
  try {
    result = await processEvent(event, idempotencyKey, sourceTenant)
  } catch (err) {
    logger.error({ err, event_type: event.type }, 'coforma webhook handler failed')
    // Still 200: we have a verified payload; surface as audit + do not
    // retry-storm Coforma. Operator can replay from webhook_events.
    result = { status: 'recorded', event_type: event.type, contact_id: null, note: 'handler_error' }
  }

  // Audit row — always write so operators can trace.
  try {
    await db.insert(webhookEvents).values({
      provider: 'coforma',
      eventType: event.type,
      payload: {
        ...event,
        idempotency_key: idempotencyKey,
        source_tenant: sourceTenant,
        result,
      },
    })
  } catch (err) {
    logger.error({ err }, 'coforma webhook audit insert failed')
  }

  return NextResponse.json(result, { headers: { 'X-RateLimit-Remaining': String(remaining) } })
}

async function processEvent(
  event: CoformaEvent,
  _idempotencyKey: string,
  _sourceTenant: string,
): Promise<ReceiveResult> {
  const db = getDb()
  switch (event.type) {
    case 'cab.member.joined': {
      const data = event.data
      // Find or note the contact (no auto-create — operator workflow).
      const contact = data.userEmail
        ? await db
            .select({ id: contacts.id })
            .from(contacts)
            .where(eq(contacts.email, data.userEmail))
            .limit(1)
        : []
      const contactId = contact[0]?.id ?? null

      if (contactId) {
        await db
          .update(contacts)
          .set({
            coformaCabMembershipId: data.membershipId,
            coformaCabId: data.cabId,
          })
          .where(eq(contacts.id, contactId))
      }
      return {
        status: 'recorded',
        event_type: event.type,
        contact_id: contactId,
        note: contactId ? 'linked' : 'no_contact_match',
      }
    }
    case 'cab.member.exited': {
      const data = event.data
      // Unlink any contact previously linked to this membership.
      const updated = await db
        .update(contacts)
        .set({ coformaCabMembershipId: null, coformaCabId: null })
        .where(eq(contacts.coformaCabMembershipId, data.membershipId))
        .returning({ id: contacts.id })
      return {
        status: 'recorded',
        event_type: event.type,
        contact_id: updated[0]?.id ?? null,
        note: `unlinked_${updated.length}`,
      }
    }
    case 'cab.feedback.created':
      // v1: log only. Followup PR will write to `activities` and surface
      // on the contact timeline.
      return { status: 'recorded', event_type: event.type, contact_id: null, note: 'logged_only' }
    default:
      return { status: 'unhandled', event_type: (event as { type: string }).type }
  }
}

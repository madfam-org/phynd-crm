import { activities, contacts, externalReferences, offers, webhookEvents } from '@phynd/db/schema'
import {
  type OpsEventSubject,
  type OpsEventType,
  type PhysicalDeliveryPayload,
  type ProjectMilestonePayload,
  type UsageLimitApproachingPayload,
  isOpsEventType,
} from '@phynd/types/ops-events'
import { and, eq, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { ConflictError } from '../errors'

/**
 * Ops-events intake (`madfam.ops.v1`).
 *
 * Receives the customer/contact-level operational events dhanam, enclii, and
 * pravara forward to `POST /api/v1/ops/events` (the route verifies the HMAC
 * signature before calling `ingest`). Each event:
 *
 *   1. is deduplicated on the envelope `id` (the `webhook_events` primary key);
 *      an `onConflictDoNothing` insert makes the probe race-safe;
 *   2. resolves to a CRM contact — `subject.contact_id` → dhanam
 *      external_reference → Janua sub → lowercased email — and is skipped
 *      (never marked, so a retry after the contact lands still lands) when
 *      unresolvable;
 *   3. writes a timeline `activities` row against the contact; and
 *   4. when the event trips an upsell rule (usage nearing the plan limit),
 *      persists a `pending` upsell `offers` row plus an `external_references`
 *      link carrying the attribution the lazy checkout mint will thread into
 *      Dhanam's Stripe session metadata.
 *
 * The upsell-dispatch worker + email is a follow-up; this service leaves it a
 * queryable seam (the pending offer + its contact-linked external reference)
 * rather than a stub.
 */

export type OpsEventIngestResult =
  | { status: 'skipped'; reason: 'unsupported_event' | 'missing_fields' | 'unresolved_contact' }
  | { status: 'duplicate'; contactId: string }
  | { status: 'accepted'; contactId: string; activityId: string; offerId: string | null }

interface NormalizedOpsEvent {
  eventId: string
  eventType: OpsEventType
  source: string
  correlationId: string | null
  dedupKey: string
  subject: OpsEventSubject
  payload: Record<string, unknown>
}

type Db = ServiceContext['db']
type OpsEventTx = Parameters<Parameters<ServiceContext['db']['transaction']>[0]>[0]

const UPSELL_THRESHOLD_PERCENT = 80
const OFFER_TTL_MS = 7 * 24 * 60 * 60 * 1000
const PLAN_LADDER = ['free', 'community', 'pro', 'business', 'enterprise'] as const

export class OpsEventsService {
  constructor(private readonly ctx: ServiceContext) {}

  async ingest(raw: Record<string, unknown>): Promise<OpsEventIngestResult> {
    if (!isOpsEventType(raw.event_type)) {
      return { status: 'skipped', reason: 'unsupported_event' }
    }

    const subject: OpsEventSubject = isRecord(raw.subject) ? raw.subject : {}
    const payload: Record<string, unknown> = isRecord(raw.payload) ? raw.payload : {}
    const source = asString(raw.source) ?? 'system'
    const dedupKey = asString(raw.dedup_key)
    // The webhook id is the dedup handle; fall back to dedup_key so an emitter
    // that omits `id` still deduplicates.
    const eventId = asString(raw.id) ?? dedupKey
    if (!eventId) {
      return { status: 'skipped', reason: 'missing_fields' }
    }

    const contactId = await this.resolveContactId(subject)
    if (!contactId) {
      return { status: 'skipped', reason: 'unresolved_contact' }
    }

    const event: NormalizedOpsEvent = {
      eventId,
      eventType: raw.event_type,
      source,
      correlationId: asString(raw.correlation_id),
      dedupKey: dedupKey ?? eventId,
      subject,
      payload,
    }

    return this.ctx.db.transaction(async (tx) => {
      const [marked] = await tx
        .insert(webhookEvents)
        .values({
          id: eventId,
          provider: source.slice(0, 20),
          eventType: event.eventType.slice(0, 100),
          payload: raw,
          processedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning()

      if (!marked) {
        return { status: 'duplicate', contactId }
      }

      const [activity] = await tx
        .insert(activities)
        .values({
          type: 'ops_event',
          title: buildActivityTitle(event).slice(0, 255),
          description: buildActivityDescription(event),
          status: 'completed',
          entityType: 'contact',
          entityId: contactId,
          // ownerId intentionally null: a system-generated timeline entry has
          // no human owner (owner_id references users.id, which no service
          // principal satisfies).
        })
        .returning()
      if (!activity) {
        throw new ConflictError('Failed to record ops-event activity')
      }

      const offerId = await this.maybeCreatePendingOffer(tx, event, contactId)

      return { status: 'accepted', contactId, activityId: activity.id, offerId }
    })
  }

  private async resolveContactId(subject: OpsEventSubject): Promise<string | null> {
    const db = this.ctx.db

    if (subject.contact_id) {
      const direct = await confirmContactId(db, subject.contact_id)
      if (direct) return direct
    }
    if (subject.dhanam_customer_id) {
      const viaRef = await findContactIdByExternalRef(db, 'dhanam', subject.dhanam_customer_id)
      if (viaRef) return viaRef
    }
    if (subject.janua_sub) {
      const viaJanua = await findContactIdByJanuaSub(db, subject.janua_sub)
      if (viaJanua) return viaJanua
    }
    if (subject.email) {
      const viaEmail = await findContactIdByEmail(db, subject.email.toLowerCase())
      if (viaEmail) return viaEmail
    }
    return null
  }

  /**
   * Persist a pending upsell offer when the event trips an upsell rule.
   * Returns the offer id, or null when no rule matched.
   */
  private async maybeCreatePendingOffer(
    tx: OpsEventTx,
    event: NormalizedOpsEvent,
    contactId: string,
  ): Promise<string | null> {
    const spec = evaluateUpsellOffer(event)
    if (!spec) return null

    const now = new Date()
    const [offer] = await tx
      .insert(offers)
      .values({
        name: spec.name.slice(0, 255),
        description: spec.description,
        type: 'upsell',
        status: 'pending',
        externalProvider: 'dhanam',
        externalProductId: spec.targetPlan.slice(0, 255),
        validFrom: now,
        validUntil: new Date(now.getTime() + OFFER_TTL_MS),
      })
      .returning()
    if (!offer) {
      throw new ConflictError('Failed to create pending upsell offer')
    }

    // Link offer → contact and carry the attribution the lazy checkout mint
    // will thread into Dhanam's Stripe session metadata. external_references
    // is the repo's cross-entity map; provider 'phynd' is the CRM-internal
    // namespace, externalId the contact id (indexed both directions).
    await tx.insert(externalReferences).values({
      entityType: 'offer',
      entityId: offer.id,
      provider: 'phynd',
      externalId: contactId,
      externalType: 'upsell_offer',
      metadata: {
        contact_id: contactId,
        dhanam_customer_id: event.subject.dhanam_customer_id ?? null,
        source_event_id: event.eventId,
        correlation_id: event.correlationId,
        event_type: event.eventType,
        current_plan: spec.currentPlan,
        suggested_plan: spec.targetPlan,
        ...spec.attribution,
      },
    })

    return offer.id
  }
}

// ---------------------------------------------------------------------------
// Upsell rule
// ---------------------------------------------------------------------------

interface UpsellOfferSpec {
  name: string
  description: string
  targetPlan: string
  currentPlan: string | null
  attribution: Record<string, unknown>
}

function evaluateUpsellOffer(event: NormalizedOpsEvent): UpsellOfferSpec | null {
  if (event.eventType !== 'ops.usage_limit_approaching') return null

  const payload = event.payload as Partial<UsageLimitApproachingPayload>
  const threshold = typeof payload.threshold_crossed === 'number' ? payload.threshold_crossed : 0
  if (threshold < UPSELL_THRESHOLD_PERCENT) return null

  const currentPlan = asString(payload.current_plan)
  const targetPlan = asString(payload.suggested_plan) ?? nextTier(currentPlan)
  if (!targetPlan) return null // already at the top tier — nothing to upsell

  const meter = asString(payload.meter) ?? 'usage'
  return {
    name: `Upsell to ${targetPlan} (${meter} at ${threshold}%)`,
    description: `Auto-generated from ops.usage_limit_approaching: ${meter} reached ${threshold}% of the ${currentPlan ?? 'current'} plan limit.`,
    targetPlan,
    currentPlan: currentPlan ?? null,
    attribution: {
      offer_source: 'ops.usage_limit_approaching',
      source_agent_id: 'phynd-upsell',
      utm_source: 'phynd-crm',
      utm_medium: 'email',
    },
  }
}

function nextTier(plan: string | null): string | null {
  if (!plan) return null
  const index = (PLAN_LADDER as readonly string[]).indexOf(plan.toLowerCase())
  if (index < 0 || index >= PLAN_LADDER.length - 1) return null
  return PLAN_LADDER[index + 1] ?? null
}

// ---------------------------------------------------------------------------
// Activity decoration
// ---------------------------------------------------------------------------

function buildActivityTitle(event: NormalizedOpsEvent): string {
  switch (event.eventType) {
    case 'ops.project_milestone_reached': {
      const p = event.payload as Partial<ProjectMilestonePayload>
      const milestone = asString(p.milestone) ?? 'reached'
      return `Milestone: ${milestone}${p.project_id ? ` (${p.project_id})` : ''}`
    }
    case 'ops.usage_limit_approaching': {
      const p = event.payload as Partial<UsageLimitApproachingPayload>
      const meter = asString(p.meter) ?? 'usage'
      return `Usage alert: ${meter} at ${p.threshold_crossed ?? '?'}%`
    }
    case 'ops.physical_delivery_confirmed': {
      const p = event.payload as Partial<PhysicalDeliveryPayload>
      return `Delivery confirmed: order ${asString(p.order_id) ?? ''}`.trim()
    }
    default:
      return 'Ops event'
  }
}

function buildActivityDescription(event: NormalizedOpsEvent): string {
  const parts = [`source=${event.source}`, `event=${event.eventType}`]
  if (event.correlationId) parts.push(`correlation=${event.correlationId}`)
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// Contact resolution
// ---------------------------------------------------------------------------

async function findContactIdByExternalRef(
  db: Db,
  provider: string,
  externalId: string,
): Promise<string | null> {
  const [ref] = await db
    .select({ entityId: externalReferences.entityId })
    .from(externalReferences)
    .where(
      and(
        eq(externalReferences.entityType, 'contact'),
        eq(externalReferences.provider, provider),
        eq(externalReferences.externalId, externalId),
      ),
    )
    .limit(1)
  if (!ref?.entityId) return null
  return confirmContactId(db, ref.entityId)
}

async function findContactIdByJanuaSub(db: Db, januaSub: string): Promise<string | null> {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.externalJanuaId, januaSub), isNull(contacts.deletedAt)))
    .limit(1)
  return row?.id ?? null
}

async function findContactIdByEmail(db: Db, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.email, email), isNull(contacts.deletedAt)))
    .limit(1)
  return row?.id ?? null
}

async function confirmContactId(db: Db, contactId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)))
    .limit(1)
  return row?.id ?? null
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

import { clientAddress } from '@/lib/client-address'
import { getCacheManager } from '@/lib/federation/clients'
import {
  type RewardDispatchOutcome,
  queueReferralRewardDispatch,
} from '@/lib/referrals/reward-dispatch'
import { checkRateLimit } from '@/lib/webhooks/rate-limiter'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import {
  conversions,
  engagementEvents,
  engagements,
  leads,
  pipelineStages,
  pipelines,
  referralCodes,
  referrals,
  webhookEvents,
} from '@phynd/db/schema'
import { CacheInvalidator, validateWebhookSignature } from '@phynd/federation'
import { createLogger } from '@phynd/logging'
import {
  CONVERTIBLE_REFERRAL_STATUSES,
  ReferralService,
  createServiceContext,
} from '@phynd/services'
import { defaultEventVisibility } from '@phynd/services/engagements/event-visibility'
import { reconcileDhanamPaymentLifecycle } from '@phynd/services/payments/payment-reconciliation'
import type { AuthContext } from '@phynd/types/auth'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import {
  type BuyerContact,
  findOrCreateBuyerContact,
  logOrphanEvent,
  resolveContactId,
} from './buyer-contact'
import {
  type CustomerStageResult,
  applyCustomerStage,
  checkoutPaymentStatus,
  eventOccurredAt,
} from './customer-stage'
import { type DhanamWebhookPayload, type NormalizedEvent, normalizeEvent } from './envelope'
import { type FailedPaymentTaskResult, maybeOpenFailedPaymentTask } from './failed-payment-task'
import { conversionLeadId } from './lead-conversion'
import {
  STRIPE_PAID_EVENT_TYPES,
  buildEngagementMessage,
  classifyPaymentLifecycle,
  conversionValue,
  engagementEventStatus,
  mapEventTypeToConversionType,
} from './payment-lifecycle'

const logger = createLogger('web:webhook:dhanam')

/**
 * Inbound receiver for Dhanam billing webhooks.
 *
 * Counterpart to Dhanam's `notifyProductWebhooks` /
 * `StripeMxSpeiRelayService` outbound dispatch. Dhanam signs the raw body
 * with `DHANAM_WEBHOOK_SECRET` and sets the header `X-Dhanam-Signature:
 * <hex-hmac-sha256>`. We accept the legacy `x-webhook-signature` header
 * too so that the previous cache-invalidation-only deployment of this
 * route stays backwards-compatible during cutover.
 *
 * What this route does (in order):
 *   1. Rate-limit (shared Redis sliding window).
 *   2. Verify HMAC signature — fail closed (401) on mismatch.
 *   3. Parse envelope. Tolerates two shapes:
 *        a) Stripe-native:  { id, type, data: { object: {...} } }
 *        b) Dhanam relay :  { id, type, timestamp, data: { customer_id, ... } }
 *   4. Idempotency — bail out cleanly (200) if `event_id` was already seen.
 *      `webhook_events` has no unique index, so the check is repeated inside
 *      the transaction under a per-event advisory lock (taken before any
 *      buyer lock) to stop overlapping retries from both recording.
 *   5. Resolve the customer:
 *        - janua_user_id → contacts.externalJanuaId (preferred)
 *        - customer_email → contacts.email (fallback)
 *      A paid event for a buyer with no contact creates the contact from
 *      the event's customer fields (see buyer-contact.ts) and then follows
 *      the same steps as a known buyer. Without a usable email no contact
 *      is created: the event is an orphan, which STILL records a
 *      webhook_events row so reconciliation can backfill it — never 5xx.
 *   6. Inside a single tx:
 *        a) Insert webhook_events audit row.
 *        b) Insert a `conversions` row (type from `mapEventTypeToConversionType`).
 *           Its `lead_id` is set only on the event that converts the lead
 *           (see lead-conversion.ts); `metadata.contact_lead_id` always names it.
 *        c) If a referral_code is in metadata, mark the matching open
 *           (`applied` or legacy `pending`) referral row as `converted` +
 *           populate `revenue_cents`; after commit its reward dispatch is
 *           queued, once (step h).
 *        d) On that converting event, mark the lead `converted` and move it to
 *           its pipeline's "Closed Won" stage (no-op if there is none).
 *        e) Append an `engagement_event` (source='dhanam',
 *           eventType='dhanam:payment_succeeded' for paid events,
 *           or `dhanam:<envelope.type>` for others) to the contact's
 *           first active engagement, if one exists.
 *        f) On a failed payment, open one follow-up task on the contact unless
 *           one is still open (see failed-payment-task.ts).
 *        g) Move the contact's lifecycle stage: paid → customer; subscription
 *           cancelled or fully refunded → former customer when no other
 *           active paid relationship is visible (see customer-stage.ts).
 *        h) After commit, queue the converted referral's reward
 *           (`queueReferralRewardDispatch`, once per referral; a failed
 *           enqueue answers 500 and the duplicate redelivery retries it).
 *   7. Invalidate federation cache (preserve the prior route's behavior).
 *   8. Return 200.
 *
 * Failure modes:
 *   - missing secret → 503 (matches the rest of the receiver fleet)
 *   - missing/invalid signature → 401
 *   - rate-limit exceeded → 429
 *   - malformed JSON → 400
 *   - shape error (no event_id / no type) → 400
 *   - DB write failure → 500 (Stripe retry will redeliver; idempotency
 *     dedupes the second attempt)
 *
 * Edge cases punted (follow-up work):
 *   - subscription tier upgrades (`customer.subscription.updated` with a
 *     plan change) — recorded as a generic conversion but the lead-stage
 *     promotion logic only fires for paid/created events.
 *   - refund / chargeback events — order payment state is reconciled, but
 *     lead/referral reversals remain operator-reviewed.
 *   - multi-lead contacts — only the most recent active lead is promoted.
 */

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.DHANAM_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  // 1. Rate limit
  const ip = clientAddress(req.headers)
  const { allowed, remaining } = await checkRateLimit(ip)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' } },
    )
  }

  // 2. Signature verification — accept the canonical `X-Dhanam-Signature`
  //    header that dhanam's `notifyProductWebhooks` / `StripeMxSpeiRelay`
  //    set; fall back to `x-webhook-signature` so legacy producers keep
  //    working.
  const rawBody = await req.text()
  const signature =
    req.headers.get('x-dhanam-signature') ?? req.headers.get('x-webhook-signature') ?? ''
  if (!signature || !validateWebhookSignature(rawBody, signature, secret)) {
    logger.warn({ ip, hasSig: Boolean(signature) }, 'rejected dhanam webhook (signature)')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // 3. Parse + normalize
  let payload: DhanamWebhookPayload
  try {
    payload = JSON.parse(rawBody) as DhanamWebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const normalized = normalizeEvent(payload)
  if (!normalized) {
    return NextResponse.json({ error: 'Missing event_id or type' }, { status: 400 })
  }

  // 7. Cache invalidation runs regardless of DB outcome — preserves the
  //    behavior of the previous cache-only route.
  try {
    const cache = getCacheManager()
    const invalidator = new CacheInvalidator(cache)
    await invalidator.invalidate('dhanam', normalized.eventType, payload as Record<string, unknown>)
  } catch (err) {
    logger.warn({ err, event_id: normalized.eventId }, 'cache invalidation failed (non-blocking)')
  }

  // 4–6. Persist the conversion.
  try {
    const result = await persistEvent(normalized)
    // 6h. After commit: the referral this event converted gets its reward
    //     queued, exactly once. A failed enqueue answers 500 so the sender
    //     redelivers; the redelivery is a duplicate and retries the queue.
    const referralReward = await maybeQueueReferralReward(normalized, result)
    if (referralReward === 'failed') {
      return NextResponse.json(
        { error: 'Referral reward not queued', referral_id: result.referral_id ?? null },
        { status: 500 },
      )
    }
    return NextResponse.json(
      { received: true, ...result, ...(referralReward ? { referral_reward: referralReward } : {}) },
      { headers: { 'X-RateLimit-Remaining': String(remaining) } },
    )
  } catch (err) {
    logger.error({ err, event_id: normalized.eventId }, 'dhanam webhook processing failed')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Referral reward (after commit)
// ---------------------------------------------------------------------------

const DHANAM_SERVICE_AUTH: AuthContext = {
  userId: 'service:dhanam-webhook',
  tenantId: DEFAULT_TENANT_ID,
  roles: ['service'],
  scopes: [],
  accessToken: 'internal:dhanam-webhook',
}

/**
 * Queues the reward for the referral this event converted inline (the same
 * dispatch `/api/referrals/convert` queues; `queueReferralRewardDispatch`
 * makes it once per referral whichever path comes first). On a duplicate
 * delivery of a paid event with a referral code it looks the referral up
 * again, so a reward whose enqueue failed on the first delivery is queued by
 * the redelivery. `null` when the event converted no referral.
 */
async function maybeQueueReferralReward(
  event: NormalizedEvent,
  result: PersistResult,
): Promise<RewardDispatchOutcome | null> {
  const ctx = createServiceContext(getDb(), getCacheManager(), DHANAM_SERVICE_AUTH)
  let referralId = result.status === 'recorded' ? (result.referral_id ?? null) : null
  if (
    result.status === 'duplicate' &&
    event.referralCode &&
    STRIPE_PAID_EVENT_TYPES.has(event.eventType)
  ) {
    try {
      referralId = await new ReferralService(ctx).findReferralConvertedByDhanamEvent(event.eventId)
    } catch (err) {
      logger.error({ err, event_id: event.eventId }, 'referral lookup on redelivery failed')
      return 'failed'
    }
  }
  if (!referralId) return null
  const outcome = await queueReferralRewardDispatch(ctx, referralId)
  logger.info({ event_id: event.eventId, referral_id: referralId, outcome }, 'referral reward')
  return outcome
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface PersistResult {
  status: 'recorded' | 'duplicate' | 'orphan'
  conversion_id?: string
  contact_id?: string | null
  contact_created?: boolean
  lead_id?: string | null
  referral_id?: string | null
  payment_reconciliation_status?: string | null
  order_id?: string | null
  quote_id?: string | null
  engagement_id?: string | null
  failed_payment_task?: FailedPaymentTaskResult
  customer_stage?: CustomerStageResult
}

/** Whether a `webhook_events` row already exists for this Dhanam event id. */
async function isEventRecorded(db: Tx | ReturnType<typeof getDb>, eventId: string) {
  const prior = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.provider, 'dhanam'),
        sql`${webhookEvents.payload} ->> 'event_id' = ${eventId}`,
      ),
    )
    .limit(1)
  return prior.length > 0
}

/** Transaction-scoped advisory lock, released at commit or rollback. */
async function lockAdvisoryKey(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
}

async function persistEvent(event: NormalizedEvent): Promise<PersistResult> {
  const db = getDb()

  // Idempotency — same event_id seen twice ⇒ one conversion row total.
  // `webhook_events` has no unique index, so this early check is only a fast
  // path; the authoritative check is repeated under a lock below.
  if (await isEventRecorded(db, event.eventId)) {
    return { status: 'duplicate' }
  }

  const contactId = await resolveContactId(event)
  const leadInfo = contactId ? await resolveLeadAndStage(contactId) : null

  return await db.transaction(async (tx: Tx) => {
    // Serialize deliveries of the same event (retries can overlap). This lock
    // is always taken first, before any buyer lock, so the order is fixed.
    await lockAdvisoryKey(tx, `phynd:dhanam:event:${event.eventId}`)
    if (await isEventRecorded(tx, event.eventId)) {
      return { status: 'duplicate' } satisfies PersistResult
    }
    return persistEventInTransaction(tx, event, contactId, leadInfo)
  })
}

async function persistEventInTransaction(
  tx: Tx,
  event: NormalizedEvent,
  matchedContactId: string | null,
  matchedLeadInfo: LeadStageInfo | null,
): Promise<PersistResult> {
  const webhookEventId = await recordWebhookAudit(tx, event)

  const buyer = matchedContactId
    ? { contactId: matchedContactId, created: false }
    : await findOrCreatePaidBuyer(tx, event)
  if (!buyer) {
    return recordOrphanEvent(event)
  }
  const { contactId } = buyer
  // A buyer first matched inside the transaction may already own a lead.
  const leadInfo =
    matchedContactId || buyer.created ? matchedLeadInfo : await resolveLeadAndStage(contactId)

  // Only the event that converts the lead is attributed to it.
  const convertedLeadId = await conversionLeadId(
    tx,
    event.eventType,
    mapEventTypeToConversionType(event.eventType),
    leadInfo,
  )
  const conversionId = await recordConversion(
    tx,
    event,
    buyer,
    leadInfo,
    convertedLeadId,
    webhookEventId,
  )
  const referralId = await maybeMarkReferralConverted(tx, event, contactId, leadInfo, conversionId)
  if (convertedLeadId && leadInfo) await promoteLead(tx, leadInfo)

  const engagementId = await maybeRecordEngagementEvent(tx, contactId, event)
  const refundedEarlier = buyer.created ? await hasEarlierRefund(tx, event) : false
  const paymentReconciliation = refundedEarlier
    ? null
    : await maybeReconcilePayment(tx, event, contactId, engagementId)
  const failedPaymentTask = await maybeOpenFailedPaymentTask(tx, event, contactId, logger)
  const customerStage = await applyCustomerStage(tx, event, contactId, paymentReconciliation)

  return {
    status: 'recorded',
    conversion_id: conversionId,
    contact_id: contactId,
    ...(buyer.created ? { contact_created: true } : {}),
    lead_id: leadInfo?.leadId ?? null,
    referral_id: referralId,
    payment_reconciliation_status: paymentReconciliation?.status ?? null,
    order_id: paymentReconciliation?.orderId ?? null,
    quote_id: paymentReconciliation?.quoteId ?? null,
    engagement_id: paymentReconciliation?.engagementId ?? engagementId ?? null,
    ...(failedPaymentTask ? { failed_payment_task: failedPaymentTask } : {}),
    ...(customerStage ? { customer_stage: customerStage } : {}),
  }
}

async function recordWebhookAudit(tx: Tx, event: NormalizedEvent): Promise<string | null> {
  const [wh] = await tx
    .insert(webhookEvents)
    .values({
      provider: 'dhanam',
      eventType: event.eventType,
      payload: buildAuditPayload(event),
      processedAt: new Date(),
    })
    .returning({ id: webhookEvents.id })

  return wh?.id ?? null
}

function buildAuditPayload(event: NormalizedEvent) {
  return {
    event_id: event.eventId,
    event_type: event.eventType,
    janua_user_id: event.januaUserId,
    customer_email: event.customerEmail,
    stripe_customer_id: event.stripeCustomerId,
    amount_minor: event.amountMinor,
    currency: event.currency,
    engagement_id: event.engagementId,
    invoice_id: event.invoiceId,
    order_id: event.orderId,
    payment_id: event.paymentId,
    plan_id: event.planId,
    quote_id: event.quoteId,
    subscription_id: event.subscriptionId,
    organization_id: event.organizationId,
    referral_code: event.referralCode,
    utm: event.utm,
    raw: event.raw,
  } satisfies Record<string, unknown>
}

/** Only a paid event creates a contact; any other event for an unknown buyer stays an orphan. */
async function findOrCreatePaidBuyer(tx: Tx, event: NormalizedEvent): Promise<BuyerContact | null> {
  if (!STRIPE_PAID_EVENT_TYPES.has(event.eventType)) return null
  return findOrCreateBuyerContact(tx, event)
}

function recordOrphanEvent(event: NormalizedEvent): PersistResult {
  logOrphanEvent(logger, event, STRIPE_PAID_EVENT_TYPES.has(event.eventType))
  return { status: 'orphan', contact_id: null, lead_id: null, referral_id: null }
}

async function recordConversion(
  tx: Tx,
  event: NormalizedEvent,
  buyer: BuyerContact,
  leadInfo: LeadStageInfo | null,
  convertedLeadId: string | null,
  webhookEventId: string | null,
): Promise<string | undefined> {
  const [conversion] = await tx
    .insert(conversions)
    .values({
      type: mapEventTypeToConversionType(event.eventType),
      contactId: buyer.contactId,
      leadId: convertedLeadId,
      value: conversionValue(event),
      metadata: {
        ...buildConversionMetadata(event, webhookEventId),
        // The contact's lead at the time, also when this event does not convert it.
        contact_lead_id: leadInfo?.leadId ?? null,
        // Provenance: this event is what created the contact.
        ...(buyer.created ? { contact_created: true } : {}),
      },
    })
    .returning({ id: conversions.id })

  return conversion?.id
}

function buildConversionMetadata(event: NormalizedEvent, webhookEventId: string | null) {
  return {
    event_id: event.eventId,
    event_type: event.eventType,
    provider: 'dhanam',
    plan_id: event.planId,
    subscription_id: event.subscriptionId,
    organization_id: event.organizationId,
    janua_user_id: event.januaUserId,
    customer_email: event.customerEmail,
    stripe_customer_id: event.stripeCustomerId,
    amount_minor: event.amountMinor,
    currency: event.currency,
    engagement_id: event.engagementId,
    invoice_id: event.invoiceId,
    order_id: event.orderId,
    payment_id: event.paymentId,
    referral_code: event.referralCode,
    quote_id: event.quoteId,
    utm: event.utm,
    webhook_event_id: webhookEventId,
  }
}

async function maybeMarkReferralConverted(
  tx: Tx,
  event: NormalizedEvent,
  contactId: string,
  leadInfo: LeadStageInfo | null,
  conversionId: string | undefined,
) {
  if (!STRIPE_PAID_EVENT_TYPES.has(event.eventType)) return null
  if (!event.referralCode) return null
  return markReferralConverted(
    tx,
    event.referralCode,
    event.customerEmail,
    event.amountMinor,
    event.planId,
    contactId,
    leadInfo?.leadId ?? null,
    conversionId ?? null,
  )
}

/** Marks the lead converted and moves it to its pipeline's Closed Won stage, if any. */
async function promoteLead(tx: Tx, leadInfo: LeadStageInfo) {
  const updateValues: { status: string; stageId?: string } = { status: 'converted' }
  if (leadInfo.closedWonStageId) {
    updateValues.stageId = leadInfo.closedWonStageId
  }
  await tx.update(leads).set(updateValues).where(eq(leads.id, leadInfo.leadId))
}

/**
 * A refund for a buyer the CRM did not know yet is stored as an orphan and
 * never applied. When the paid event for that payment then creates the
 * contact (for example a retried paid event arriving after the refund), the
 * order must not be reconciled as paid. Returns true when such a stored refund
 * exists; the caller then skips reconciliation and leaves it to an operator.
 */
async function hasEarlierRefund(tx: Tx, event: NormalizedEvent): Promise<boolean> {
  if (!event.paymentId) return false
  const stored = await tx
    .select({ id: webhookEvents.id, eventType: webhookEvents.eventType })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.provider, 'dhanam'),
        sql`${webhookEvents.payload} ->> 'payment_id' = ${event.paymentId}`,
      ),
    )
  const refund = stored.find(
    (row: { id: string; eventType: string }) =>
      classifyPaymentLifecycle(row.eventType) === 'refunded',
  )
  if (!refund) return false
  logger.warn(
    {
      event_id: event.eventId,
      payment_id: event.paymentId,
      refund_webhook_event_id: refund.id,
    },
    'DHANAM_PAID_AFTER_STORED_REFUND: a refund for this payment was stored before the buyer had a contact — order not reconciled as paid',
  )
  return true
}

async function maybeReconcilePayment(
  tx: Tx,
  event: NormalizedEvent,
  contactId: string,
  engagementId: string | null,
) {
  const lifecycle = classifyPaymentLifecycle(event.eventType)
  if (!lifecycle) return null
  return reconcileDhanamPaymentLifecycle(tx, {
    amountMinor: event.amountMinor,
    contactId,
    currency: event.currency,
    engagementId: event.engagementId ?? engagementId,
    eventId: event.eventId,
    eventType: event.eventType,
    externalPaymentId: event.paymentId ?? event.invoiceId ?? event.eventId,
    lifecycle,
    checkoutPaymentStatus: checkoutPaymentStatus(event.raw),
    // When the money moved, as the sender states it: the order's paid date and
    // the time the stage rule compares with.
    occurredAt: eventOccurredAt(event.raw),
    orderId: event.orderId,
    quoteId: event.quoteId,
  })
}

interface LeadStageInfo {
  leadId: string
  status: string
  pipelineId: string
  closedWonStageId: string | null
}

async function resolveLeadAndStage(contactId: string): Promise<LeadStageInfo | null> {
  const db = getDb()
  const [lead] = await db
    .select({ id: leads.id, status: leads.status, pipelineId: leads.pipelineId })
    .from(leads)
    .where(and(eq(leads.contactId, contactId), isNull(leads.deletedAt)))
    .orderBy(desc(leads.createdAt))
    .limit(1)
  if (!lead?.id) return null

  // Find the pipeline's "Closed Won" (or equivalent) stage. Match
  // case-insensitively to tolerate case drift in seed data.
  const stageRows = await db
    .select({ id: pipelineStages.id, name: pipelineStages.name })
    .from(pipelineStages)
    .innerJoin(pipelines, eq(pipelineStages.pipelineId, pipelines.id))
    .where(eq(pipelineStages.pipelineId, lead.pipelineId))

  type StageRow = (typeof stageRows)[number]
  const closedWon = stageRows.find((s: StageRow) => s.name.toLowerCase() === 'closed won')
  return {
    leadId: lead.id,
    status: lead.status,
    pipelineId: lead.pipelineId,
    closedWonStageId: closedWon?.id ?? null,
  }
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

async function markReferralConverted(
  tx: Tx,
  code: string,
  referredEmail: string | null,
  amountMinor: number | null,
  planId: string | null,
  contactId: string,
  leadId: string | null,
  conversionId: string | null,
): Promise<string | null> {
  // Resolve the code → id, then promote the matching pending referral.
  const [codeRow] = await tx
    .select({ id: referralCodes.id })
    .from(referralCodes)
    .where(eq(referralCodes.code, code))
    .limit(1)
  if (!codeRow?.id) return null

  // Match the referral row that was applied for this code+email.
  // Falls back to any open referral for this code if email is absent
  // (legacy referrals applied without a recorded email).
  // `applied` is what the apply API writes; `pending` is the legacy default.
  const conditions = [
    eq(referrals.referralCodeId, codeRow.id),
    inArray(referrals.status, [...CONVERTIBLE_REFERRAL_STATUSES]),
  ]
  if (referredEmail) {
    conditions.push(eq(referrals.referredEmail, referredEmail))
  }

  const [referral] = await tx
    .select({ id: referrals.id })
    .from(referrals)
    .where(and(...conditions))
    .orderBy(desc(referrals.createdAt))
    .limit(1)
  if (!referral?.id) return null

  await tx
    .update(referrals)
    .set({
      status: 'converted',
      revenueCents: amountMinor,
      planId,
      contactId,
      leadId,
      conversionId,
      convertedAt: new Date(),
    })
    .where(eq(referrals.id, referral.id))

  return referral.id
}

async function maybeRecordEngagementEvent(
  tx: Tx,
  contactId: string,
  event: NormalizedEvent,
): Promise<string | null> {
  // Pick the first active (non-deleted) engagement for this contact —
  // matches the convention in the Pravara webhook handler. If there's no
  // engagement (pre-portal client, or a self-serve Dhanam-only customer),
  // skip silently.
  const [eng] = await tx
    .select({ id: engagements.id })
    .from(engagements)
    .where(
      and(
        eq(engagements.contactId, contactId),
        eq(engagements.status, 'active'),
        isNull(engagements.deletedAt),
      ),
    )
    .orderBy(engagements.createdAt)
    .limit(1)
  if (!eng?.id) return null

  const portalEventType = STRIPE_PAID_EVENT_TYPES.has(event.eventType)
    ? 'dhanam:payment_succeeded'
    : `dhanam:${event.eventType}`

  await tx.insert(engagementEvents).values({
    engagementId: eng.id,
    source: 'dhanam',
    eventType: portalEventType,
    // Only "payment received" is client-visible (allowlist); failures,
    // refunds and disputes stay internal.
    visibility: defaultEventVisibility(portalEventType),
    status: engagementEventStatus(event.eventType),
    message: buildEngagementMessage(event),
    metadata: {
      event_id: event.eventId,
      raw_event_type: event.eventType,
      plan_id: event.planId,
      subscription_id: event.subscriptionId,
      amount_minor: event.amountMinor,
      currency: event.currency,
      engagement_id: event.engagementId,
      invoice_id: event.invoiceId,
      order_id: event.orderId,
      payment_id: event.paymentId,
      quote_id: event.quoteId,
    },
    // Idempotency for the engagement timeline — `engagement_events` has a
    // `(engagement_id, dedup_key)` composite index for fast lookups, but
    // no unique constraint. `webhook_events` has no unique constraint
    // either: duplicate processing is prevented by the per-event advisory
    // lock and the re-check in `persistEvent`, so this is purely a logical
    // dedup key for portal-side queries.
    dedupKey: `dhanam:${event.eventId}`,
  })

  return eng.id
}

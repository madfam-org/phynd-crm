import { getCacheManager } from '@/lib/federation/clients'
import { checkRateLimit } from '@/lib/webhooks/rate-limiter'
import { getDb } from '@phyne/db'
import {
  contacts,
  conversions,
  engagementEvents,
  engagements,
  leads,
  pipelineStages,
  pipelines,
  referralCodes,
  referrals,
  webhookEvents,
} from '@phyne/db/schema'
import { CacheInvalidator, validateWebhookSignature } from '@phyne/federation'
import { createLogger } from '@phyne/logging'
import { reconcileDhanamPaymentLifecycle } from '@phyne/services/payments/payment-reconciliation'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import {
  STRIPE_PAID_EVENT_TYPES,
  buildEngagementMessage,
  classifyPaymentLifecycle,
  conversionValue,
  engagementEventStatus,
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
 *   5. Resolve the customer:
 *        - janua_user_id → contacts.externalJanuaId (preferred)
 *        - customer_email → contacts.email (fallback)
 *      Orphan events (no contact match) STILL record a webhook_events row
 *      so reconciliation can backfill them — never 5xx for that case.
 *   6. Inside a single tx:
 *        a) Insert webhook_events audit row.
 *        b) Insert a `conversions` row (type=`dhanam_<event-suffix>`).
 *        c) If a referral_code is in metadata, mark the matching referral
 *           row as `converted` + populate `revenue_cents`.
 *        d) Mark the contact's most recent active lead as `converted` +
 *           move it to its pipeline's "Closed Won" stage (no-op if the
 *           pipeline has no such stage).
 *        e) Append an `engagement_event` (source='dhanam',
 *           eventType='dhanam:payment_succeeded' for paid events,
 *           or `dhanam:<envelope.type>` for others) to the contact's
 *           first active engagement, if one exists.
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

interface DhanamWebhookPayload {
  // Top-level envelope
  id?: string
  event_id?: string
  type?: string
  event?: string
  timestamp?: string
  // Dhanam relay shape (notifyProductWebhooks / StripeMxSpeiRelay)
  data?: Record<string, unknown> & {
    object?: Record<string, unknown>
  }
}

interface NormalizedEvent {
  eventId: string
  eventType: string
  // Customer identity hints (any combination may be present).
  januaUserId: string | null
  customerEmail: string | null
  stripeCustomerId: string | null
  // Money. amount_minor is in the smallest currency unit (cents/centavos).
  amountMinor: number | null
  currency: string | null
  // Subscription metadata
  engagementId: string | null
  invoiceId: string | null
  orderId: string | null
  paymentId: string | null
  planId: string | null
  quoteId: string | null
  subscriptionId: string | null
  organizationId: string | null
  // Attribution (from Stripe checkout metadata)
  referralCode: string | null
  utm: Record<string, string>
  // The full original payload — written verbatim into webhook_events.
  raw: Record<string, unknown>
}

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.DHANAM_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  // 1. Rate limit
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
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
    return NextResponse.json(
      { received: true, ...result },
      { headers: { 'X-RateLimit-Remaining': String(remaining) } },
    )
  } catch (err) {
    logger.error({ err, event_id: normalized.eventId }, 'dhanam webhook processing failed')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeEvent(payload: DhanamWebhookPayload): NormalizedEvent | null {
  const eventId = (payload.event_id ?? payload.id ?? '').toString()
  const eventType = (payload.type ?? payload.event ?? '').toString()
  if (!eventId || !eventType) return null

  // Stripe-native events nest the resource under `data.object`. Dhanam's
  // own relay flattens the resource fields directly under `data` (matches
  // the Karafiel `DhanamPaymentDataSerializer` contract). Try both.
  const data = (payload.data ?? {}) as Record<string, unknown>
  const obj = (data.object ?? {}) as Record<string, unknown>
  const stripeMetadata = (obj.metadata ?? {}) as Record<string, unknown>
  const dataMetadata = (data.metadata ?? {}) as Record<string, unknown>
  const merged = { ...dataMetadata, ...stripeMetadata }

  const identity = extractIdentityHints(obj, data, merged)
  const billing = extractBillingHints(obj, data, merged)
  const lifecycle = extractLifecycleHints(data, merged)
  const attribution = extractAttributionHints(merged, dataMetadata)

  return {
    eventId,
    eventType,
    ...identity,
    ...billing,
    ...lifecycle,
    ...attribution,
    raw: payload as Record<string, unknown>,
  }
}

function extractIdentityHints(
  stripeObject: Record<string, unknown>,
  dhanamData: Record<string, unknown>,
  metadata: Record<string, unknown>,
) {
  const customerEmail = pickString(
    stripeObject.customer_email,
    stripeObject.customer_details &&
      (stripeObject.customer_details as Record<string, unknown>).email,
    dhanamData.customer_email,
    metadata.customer_email,
    metadata.email,
  )

  return {
    januaUserId: pickString(
      metadata.janua_user_id,
      dhanamData.janua_user_id,
      metadata.januaUserId,
      dhanamData.customer_id,
    ),
    customerEmail: customerEmail ? customerEmail.toLowerCase() : null,
    stripeCustomerId: pickString(
      stripeObject.customer,
      dhanamData.stripe_customer_id,
      metadata.stripe_customer_id,
    ),
  }
}

function extractBillingHints(
  stripeObject: Record<string, unknown>,
  dhanamData: Record<string, unknown>,
  metadata: Record<string, unknown>,
) {
  return {
    amountMinor: pickAmountMinor(stripeObject, dhanamData),
    currency:
      pickString(
        stripeObject.currency,
        dhanamData.currency,
        (stripeObject as { currency?: string }).currency,
      )?.toUpperCase() ?? null,
    invoiceId: pickString(
      stripeObject.invoice,
      dhanamData.invoice_id,
      dhanamData.invoiceId,
      metadata.invoice_id,
    ),
    organizationId: pickString(
      metadata.org_id,
      metadata.organization_id,
      dhanamData.organization_id,
    ),
    paymentId: pickString(
      stripeObject.payment_intent,
      stripeObject.payment,
      dhanamData.payment_id,
      dhanamData.paymentId,
      metadata.payment_id,
      metadata.paymentId,
    ),
    planId: pickString(
      metadata.plan,
      metadata.plan_id,
      dhanamData.plan_id,
      extractFirstPriceId(stripeObject),
    ),
    subscriptionId: pickString(
      stripeObject.subscription,
      stripeObject.id,
      dhanamData.subscription_id,
      metadata.subscription_id,
    ),
  }
}

function extractLifecycleHints(
  dhanamData: Record<string, unknown>,
  metadata: Record<string, unknown>,
) {
  return {
    engagementId: pickString(
      metadata.engagement_id,
      metadata.engagementId,
      dhanamData.engagement_id,
      dhanamData.engagementId,
    ),
    quoteId: pickString(
      metadata.quote_id,
      metadata.quoteId,
      dhanamData.quote_id,
      dhanamData.quoteId,
    ),
    orderId: pickString(
      metadata.order_id,
      metadata.orderId,
      dhanamData.order_id,
      dhanamData.orderId,
    ),
  }
}

function extractAttributionHints(
  metadata: Record<string, unknown>,
  dataMetadata: Record<string, unknown>,
) {
  return {
    referralCode: pickString(metadata.referral_code, dataMetadata.referral_code),
    utm: Object.fromEntries(
      Object.entries(metadata).filter(
        ([key, value]) => key.startsWith('utm_') && typeof value === 'string',
      ),
    ) as Record<string, string>,
  }
}

function extractFirstPriceId(stripeObject: Record<string, unknown>) {
  const items = stripeObject.items as Record<string, unknown> | undefined
  const firstItem = (items?.data as Array<Record<string, unknown>> | undefined)?.[0]
  return (firstItem?.price as Record<string, unknown> | undefined)?.id
}

function pickString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

function pickAmountMinor(
  stripeObject: Record<string, unknown>,
  dhanamData: Record<string, unknown>,
): number | null {
  // Stripe checkout.session: amount_total (already in minor).
  // Stripe invoice: amount_paid.
  // Dhanam relay: amount_minor (preferred) or amount (in major units).
  const candidates: Array<unknown> = [
    stripeObject.amount_total,
    stripeObject.amount_paid,
    stripeObject.amount_due,
    stripeObject.amount,
    dhanamData.amount_minor,
  ]
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c
  }
  // Major-unit fallback — convert to minor. Accepts both string ("199.00")
  // and number (199.00) representations from the Karafiel-shaped envelope.
  const major = dhanamData.amount
  if (typeof major === 'number' && Number.isFinite(major)) return Math.round(major * 100)
  if (typeof major === 'string' && major.length > 0) {
    const parsed = Number.parseFloat(major)
    if (Number.isFinite(parsed)) return Math.round(parsed * 100)
  }
  return null
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface PersistResult {
  status: 'recorded' | 'duplicate' | 'orphan'
  conversion_id?: string
  contact_id?: string | null
  lead_id?: string | null
  referral_id?: string | null
  payment_reconciliation_status?: string | null
  order_id?: string | null
  quote_id?: string | null
  engagement_id?: string | null
}

async function persistEvent(event: NormalizedEvent): Promise<PersistResult> {
  const db = getDb()

  // Idempotency — same event_id seen twice ⇒ one conversion row total.
  const prior = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.provider, 'dhanam'),
        sql`${webhookEvents.payload} ->> 'event_id' = ${event.eventId}`,
      ),
    )
    .limit(1)
  if (prior.length > 0) {
    return { status: 'duplicate' }
  }

  const contactId = await resolveContactId(event)
  const leadInfo = contactId ? await resolveLeadAndStage(contactId) : null

  return await db.transaction((tx) => persistEventInTransaction(tx, event, contactId, leadInfo))
}

async function persistEventInTransaction(
  tx: Tx,
  event: NormalizedEvent,
  contactId: string | null,
  leadInfo: LeadStageInfo | null,
): Promise<PersistResult> {
  const webhookEventId = await recordWebhookAudit(tx, event)

  if (!contactId) {
    return recordOrphanEvent(event)
  }

  const conversionId = await recordConversion(tx, event, contactId, leadInfo, webhookEventId)
  const referralId = await maybeMarkReferralConverted(tx, event, contactId, leadInfo, conversionId)
  await maybePromoteLead(tx, event, leadInfo)

  const engagementId = await maybeRecordEngagementEvent(tx, contactId, event)
  const paymentReconciliation = await maybeReconcilePayment(tx, event, contactId, engagementId)

  return {
    status: 'recorded',
    conversion_id: conversionId,
    contact_id: contactId,
    lead_id: leadInfo?.leadId ?? null,
    referral_id: referralId,
    payment_reconciliation_status: paymentReconciliation?.status ?? null,
    order_id: paymentReconciliation?.orderId ?? null,
    quote_id: paymentReconciliation?.quoteId ?? null,
    engagement_id: paymentReconciliation?.engagementId ?? engagementId ?? null,
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

function recordOrphanEvent(event: NormalizedEvent): PersistResult {
  logger.warn(
    { event_id: event.eventId, event_type: event.eventType, janua_user_id: event.januaUserId },
    'dhanam event received but no contact match — orphan logged',
  )
  return { status: 'orphan', contact_id: null, lead_id: null, referral_id: null }
}

async function recordConversion(
  tx: Tx,
  event: NormalizedEvent,
  contactId: string,
  leadInfo: LeadStageInfo | null,
  webhookEventId: string | null,
): Promise<string | undefined> {
  const [conversion] = await tx
    .insert(conversions)
    .values({
      type: mapEventTypeToConversionType(event.eventType),
      contactId,
      leadId: leadInfo?.leadId ?? null,
      value: conversionValue(event),
      metadata: buildConversionMetadata(event, webhookEventId),
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

async function maybePromoteLead(tx: Tx, event: NormalizedEvent, leadInfo: LeadStageInfo | null) {
  if (!leadInfo || !STRIPE_PAID_EVENT_TYPES.has(event.eventType)) return
  const updateValues: { status: string; stageId?: string } = { status: 'converted' }
  if (leadInfo.closedWonStageId) {
    updateValues.stageId = leadInfo.closedWonStageId
  }
  await tx.update(leads).set(updateValues).where(eq(leads.id, leadInfo.leadId))
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
    orderId: event.orderId,
    quoteId: event.quoteId,
  })
}

async function resolveContactId(event: NormalizedEvent): Promise<string | null> {
  const db = getDb()
  // Strategy: janua_user_id (richer mapping) → email (fallback).
  // We deliberately skip `stripe_customer_id` matching — PhyneCRM doesn't
  // store Stripe customer IDs anywhere (the federation provider fetches
  // billing state on-demand from dhanam itself).
  if (event.januaUserId) {
    const [row] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.externalJanuaId, event.januaUserId), isNull(contacts.deletedAt)))
      .limit(1)
    if (row?.id) return row.id
  }
  if (event.customerEmail) {
    const [row] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.email, event.customerEmail), isNull(contacts.deletedAt)))
      .limit(1)
    if (row?.id) return row.id
  }
  return null
}

interface LeadStageInfo {
  leadId: string
  pipelineId: string
  closedWonStageId: string | null
}

async function resolveLeadAndStage(contactId: string): Promise<LeadStageInfo | null> {
  const db = getDb()
  const [lead] = await db
    .select({ id: leads.id, pipelineId: leads.pipelineId })
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

  const closedWon = stageRows.find((s) => s.name.toLowerCase() === 'closed won')
  return {
    leadId: lead.id,
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
  // Falls back to any pending referral for this code if email is absent
  // (legacy referrals applied without a recorded email).
  const conditions = [eq(referrals.referralCodeId, codeRow.id), eq(referrals.status, 'pending')]
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
    // no unique constraint. The unique constraint on `webhook_events`
    // already prevents duplicate processing, so this is purely a logical
    // dedup key for portal-side queries.
    dedupKey: `dhanam:${event.eventId}`,
  })

  return eng.id
}

function mapEventTypeToConversionType(eventType: string): string {
  // Keep these tight + stable; analytics queries filter on `conversions.type`.
  // Use a `dhanam_` prefix to disambiguate from `ecosystem_payment_succeeded`
  // (routecraft) and the existing visitor_to_lead / lead_to_opportunity etc.
  if (eventType === 'checkout.session.completed') return 'dhanam_checkout_completed'
  if (eventType === 'customer.subscription.created' || eventType === 'subscription.created') {
    return 'dhanam_subscription_created'
  }
  if (eventType === 'invoice.payment_succeeded' || eventType === 'payment.succeeded') {
    return 'dhanam_payment_succeeded'
  }
  return `dhanam_${eventType.replace(/[^a-z0-9_]+/gi, '_')}`
}

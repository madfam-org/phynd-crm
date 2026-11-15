/**
 * The Dhanam billing webhook envelope: the payload shapes the receiver
 * tolerates and the normalization that turns either of them into one event.
 * Pure functions over the parsed body; nothing here touches the database.
 * Split out of route.ts to keep that file within the size limit.
 */

export interface DhanamWebhookPayload {
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

export interface NormalizedEvent {
  eventId: string
  eventType: string
  // Customer identity hints (any combination may be present).
  januaUserId: string | null
  // A Janua subject the event names explicitly (never a billing customer id).
  januaSubject: string | null
  customerEmail: string | null
  customerName: string | null
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

export function normalizeEvent(payload: DhanamWebhookPayload): NormalizedEvent | null {
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
  const customerDetails = (stripeObject.customer_details ?? {}) as Record<string, unknown>
  const customerEmail = pickString(
    stripeObject.customer_email,
    customerDetails.email,
    dhanamData.customer_email,
    metadata.customer_email,
    metadata.email,
  )
  const januaSubject = pickString(
    metadata.janua_user_id,
    dhanamData.janua_user_id,
    metadata.januaUserId,
  )

  return {
    januaUserId: januaSubject ?? pickString(dhanamData.customer_id),
    januaSubject,
    customerEmail: customerEmail ? customerEmail.toLowerCase() : null,
    customerName: pickString(
      dhanamData.buyer_name,
      dhanamData.customer_name,
      customerDetails.name,
      metadata.customer_name,
    ),
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

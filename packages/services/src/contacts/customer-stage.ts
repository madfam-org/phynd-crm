/**
 * The one rule for a contact's lifecycle stage (`contacts.lifecycle_stage`).
 *
 *   - Money received (a paid billing event, an order that becomes paid or
 *     partly paid, a verified payment) makes the contact a CUSTOMER.
 *   - A subscription cancellation or a full refund makes a customer a FORMER
 *     CUSTOMER, unless another active paid relationship is visible: another
 *     order still paid, partly paid or partly refunded, or another
 *     subscription whose start was recorded and whose cancellation was not.
 *   - Nothing moves a contact back to lead.
 *   - Each change records the time of the event behind it
 *     (`lifecycle_stage_changed_at`); an event older than the last change (a
 *     late redelivery) changes nothing. Later money from a customer moves that
 *     time forward without changing the stage, so an end is compared with the
 *     latest money received, not the first.
 *
 * Called inside the transaction that records the payment, so the stage moves
 * with it or not at all. Migrations 0022 and 0023 apply the same rule to past
 * data.
 */
import { contacts, conversions, orders } from '@phynd/db/schema'
import { and, eq, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'

type Db = Pick<ServiceContext['db'], 'select' | 'update'>

/** Order payment states that still hold money received. */
export const ACTIVE_PAID_ORDER_STATES = ['paid', 'partial', 'partial_refund'] as const

/** Order payment states that mean money was received (an order "becomes paid"). */
export const PAID_ORDER_STATES: ReadonlySet<string> = new Set(['paid', 'partial'])

/** Billing event types that end a subscription (Stripe-native and the Dhanam relay). */
export const SUBSCRIPTION_CANCELLED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'customer.subscription.deleted',
  'subscription.cancelled',
  'subscription.canceled',
  'subscription.deleted',
])

/** `conversions.type` of a subscription start. */
const SUBSCRIPTION_STARTED_CONVERSION_TYPE = 'dhanam_subscription_created'

/** Billing event types that always mean a payment was collected. */
export const MONEY_RECEIVED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'invoice.payment_succeeded',
  'payment.succeeded',
])

/** A checkout completion is money only when its payment is already collected. */
export const CHECKOUT_COMPLETED_EVENT_TYPE = 'checkout.session.completed'

/**
 * Whether a billing event means money was received: a successful payment, or
 * a completed checkout whose `payment_status` is `paid`. A subscription start
 * and an asynchronous checkout completion (paid later, or never) are not.
 */
export function isMoneyReceivedEvent(
  eventType: string,
  checkoutPaymentStatus: string | null | undefined,
): boolean {
  if (MONEY_RECEIVED_EVENT_TYPES.has(eventType)) return true
  return eventType === CHECKOUT_COMPLETED_EVENT_TYPE && checkoutPaymentStatus === 'paid'
}

export type StageChange =
  | { stage: 'customer' | 'former_customer'; changed: boolean }
  | { stage: 'customer'; changed: false; kept: 'other_active_paid_relationship' }

/**
 * Money from this contact was received at `at`: lead → customer, and former
 * customer → customer unless the change to former customer came later. For a
 * contact already a customer, a later payment only moves
 * `lifecycle_stage_changed_at` forward (reported as no change of stage).
 */
export async function markCustomer(db: Db, contactId: string, at: Date): Promise<StageChange> {
  const changed = await db
    .update(contacts)
    .set({ lifecycleStage: 'customer', lifecycleStageChangedAt: at })
    .where(
      and(
        eq(contacts.id, contactId),
        or(
          eq(contacts.lifecycleStage, 'lead'),
          and(
            eq(contacts.lifecycleStage, 'former_customer'),
            or(isNull(contacts.lifecycleStageChangedAt), lte(contacts.lifecycleStageChangedAt, at)),
          ),
        ),
      ),
    )
    .returning({ id: contacts.id })
  if (changed.length > 0) return { stage: 'customer', changed: true }

  // Already a customer: the latest money received is what an end is compared with.
  await db
    .update(contacts)
    .set({ lifecycleStageChangedAt: at })
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.lifecycleStage, 'customer'),
        or(isNull(contacts.lifecycleStageChangedAt), lt(contacts.lifecycleStageChangedAt, at)),
      ),
    )
  return { stage: 'customer', changed: false }
}

export interface EndedRelationship {
  /** The order the refund applied to; not counted as still active. */
  orderId?: string | null
  /** The subscription that was cancelled; not counted as still active. */
  subscriptionId?: string | null
}

/**
 * A subscription was cancelled or a payment fully refunded at `at`. Returns
 * null when the stage does not move (not a customer, or the event is older
 * than the change that made them one).
 */
export async function markFormerCustomer(
  db: Db,
  contactId: string,
  at: Date,
  ended: EndedRelationship,
): Promise<StageChange | null> {
  const [contact] = await db
    .select({
      stage: contacts.lifecycleStage,
      changedAt: contacts.lifecycleStageChangedAt,
    })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1)
  if (contact?.stage !== 'customer') return null
  if (contact.changedAt && at.getTime() < new Date(contact.changedAt).getTime()) return null

  if (await hasOtherActivePaidRelationship(db, contactId, ended)) {
    return { stage: 'customer', changed: false, kept: 'other_active_paid_relationship' }
  }
  const changed = await db
    .update(contacts)
    .set({ lifecycleStage: 'former_customer', lifecycleStageChangedAt: at })
    .where(and(eq(contacts.id, contactId), eq(contacts.lifecycleStage, 'customer')))
    .returning({ id: contacts.id })
  return changed.length > 0 ? { stage: 'former_customer', changed: true } : null
}

export async function hasOtherActivePaidRelationship(
  db: Db,
  contactId: string,
  ended: EndedRelationship,
): Promise<boolean> {
  const orderConditions = [
    eq(orders.contactId, contactId),
    isNull(orders.deletedAt),
    inArray(orders.paymentStatus, [...ACTIVE_PAID_ORDER_STATES]),
  ]
  if (ended.orderId) orderConditions.push(ne(orders.id, ended.orderId))
  const [paidOrder] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(...orderConditions))
    .limit(1)
  if (paidOrder) return true

  // Subscriptions the CRM saw start, minus those it saw end.
  const rows = await db
    .select({
      subscriptionId: sql<string | null>`${conversions.metadata} ->> 'subscription_id'`,
      eventType: sql<string | null>`${conversions.metadata} ->> 'event_type'`,
      type: conversions.type,
    })
    .from(conversions)
    .where(
      and(
        eq(conversions.contactId, contactId),
        sql`${conversions.metadata} ->> 'provider' = 'dhanam'`,
        sql`${conversions.metadata} ->> 'subscription_id' is not null`,
      ),
    )
  const started = new Set<string>()
  const endedIds = new Set<string>()
  for (const row of rows) {
    if (!row.subscriptionId) continue
    if (row.type === SUBSCRIPTION_STARTED_CONVERSION_TYPE) started.add(row.subscriptionId)
    if (row.eventType && SUBSCRIPTION_CANCELLED_EVENT_TYPES.has(row.eventType)) {
      endedIds.add(row.subscriptionId)
    }
  }
  if (ended.subscriptionId) endedIds.add(ended.subscriptionId)
  for (const id of started) if (!endedIds.has(id)) return true
  return false
}

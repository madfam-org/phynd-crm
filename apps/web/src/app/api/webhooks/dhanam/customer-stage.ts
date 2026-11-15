import type { getDb } from '@phynd/db'
import { contacts, conversions, orders } from '@phynd/db/schema'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { STRIPE_PAID_EVENT_TYPES, classifyPaymentLifecycle } from './payment-lifecycle'

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

/** Billing events that end a subscription (Stripe-native and the Dhanam relay). */
export const SUBSCRIPTION_CANCELLED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'customer.subscription.deleted',
  'subscription.cancelled',
  'subscription.canceled',
  'subscription.deleted',
])

/** `conversions.type` of a subscription start, as the route maps it. */
const SUBSCRIPTION_STARTED_CONVERSION_TYPE = 'dhanam_subscription_created'
/** Order payment states that mean money was received and not given back. */
const PAID_ORDER_STATES = ['paid', 'partial'] as const

export interface StageEvent {
  eventId: string
  eventType: string
  orderId: string | null
  subscriptionId: string | null
  raw: Record<string, unknown>
}

export interface StageReconciliation {
  orderId: string | null
  paymentStatus: string | null
}

export type CustomerStageResult =
  | { stage: 'customer' | 'former_customer'; changed: boolean }
  | { stage: 'customer'; changed: false; kept: 'other_active_paid_relationship' }

/**
 * Moves the contact's lifecycle stage on a billing event. Runs inside the
 * event's transaction, after the conversion and the payment reconciliation
 * are recorded.
 *
 * - A successful payment makes the contact a customer (also from former
 *   customer: they paid again).
 * - A subscription cancellation, or a refund that leaves the payment fully
 *   refunded, makes a CUSTOMER a former customer, unless another active paid
 *   relationship is visible: another order still paid (fully or in part), or
 *   another subscription whose start was recorded and whose cancellation was
 *   not. A lead never becomes a former customer, and nothing moves a contact
 *   back to lead.
 */
export async function applyCustomerStage(
  tx: Tx,
  event: StageEvent,
  contactId: string,
  reconciliation: StageReconciliation | null,
): Promise<CustomerStageResult | null> {
  if (STRIPE_PAID_EVENT_TYPES.has(event.eventType)) {
    const changed = await tx
      .update(contacts)
      .set({ lifecycleStage: 'customer' })
      .where(and(eq(contacts.id, contactId), ne(contacts.lifecycleStage, 'customer')))
      .returning({ id: contacts.id })
    return { stage: 'customer', changed: changed.length > 0 }
  }

  const cancelled = SUBSCRIPTION_CANCELLED_EVENT_TYPES.has(event.eventType)
  if (!cancelled && !isFullRefund(event, reconciliation)) return null

  const [contact] = await tx
    .select({ stage: contacts.lifecycleStage })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1)
  if (contact?.stage !== 'customer') return null

  const endedOrderId = reconciliation?.orderId ?? event.orderId
  const endedSubscriptionId = cancelled ? event.subscriptionId : null
  if (await hasOtherActivePaidRelationship(tx, contactId, endedOrderId, endedSubscriptionId)) {
    return { stage: 'customer', changed: false, kept: 'other_active_paid_relationship' }
  }

  await tx
    .update(contacts)
    .set({ lifecycleStage: 'former_customer' })
    .where(and(eq(contacts.id, contactId), eq(contacts.lifecycleStage, 'customer')))
  return { stage: 'former_customer', changed: true }
}

/**
 * Whether a refund event leaves its payment fully refunded: the reconciled
 * order says so, or the processor's own object does (Stripe `refunded: true`,
 * or `amount_refunded` reaching `amount`). A partial or unknown refund is not.
 */
export function isFullRefund(
  event: Pick<StageEvent, 'eventType' | 'raw'>,
  reconciliation: StageReconciliation | null,
): boolean {
  if (classifyPaymentLifecycle(event.eventType) !== 'refunded') return false
  if (reconciliation?.paymentStatus === 'refunded') return true
  if (reconciliation?.paymentStatus) return false
  const data = asRecord(event.raw.data)
  const object = asRecord(data.object)
  if (object.refunded === true || data.refunded === true) return true
  const amount = firstNumber(object.amount, object.amount_captured)
  const refunded = firstNumber(object.amount_refunded)
  return amount !== null && refunded !== null && amount > 0 && refunded >= amount
}

async function hasOtherActivePaidRelationship(
  tx: Tx,
  contactId: string,
  endedOrderId: string | null,
  endedSubscriptionId: string | null,
): Promise<boolean> {
  const orderConditions = [
    eq(orders.contactId, contactId),
    isNull(orders.deletedAt),
    inArray(orders.paymentStatus, [...PAID_ORDER_STATES]),
  ]
  if (endedOrderId) orderConditions.push(ne(orders.id, endedOrderId))
  const [paidOrder] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(...orderConditions))
    .limit(1)
  if (paidOrder) return true

  // Subscriptions the CRM saw start, minus those it saw end.
  const rows = await tx
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
  const ended = new Set<string>()
  for (const row of rows) {
    if (!row.subscriptionId) continue
    if (row.type === SUBSCRIPTION_STARTED_CONVERSION_TYPE) started.add(row.subscriptionId)
    if (row.eventType && SUBSCRIPTION_CANCELLED_EVENT_TYPES.has(row.eventType)) {
      ended.add(row.subscriptionId)
    }
  }
  if (endedSubscriptionId) ended.add(endedSubscriptionId)
  for (const id of started) if (!ended.has(id)) return true
  return false
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

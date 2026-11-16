import type { getDb } from '@phynd/db'
import {
  SUBSCRIPTION_CANCELLED_EVENT_TYPES,
  type StageChange,
  isMoneyReceivedEvent,
  markCustomer,
  markFormerCustomer,
} from '@phynd/services/contacts/customer-stage'
import { classifyPaymentLifecycle } from './payment-lifecycle'

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

export { SUBSCRIPTION_CANCELLED_EVENT_TYPES }
export type CustomerStageResult = StageChange

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

/**
 * Applies the shared stage rule (`@phynd/services` `contacts/customer-stage.ts`)
 * to a billing event, inside the event's transaction, after the conversion and
 * the payment reconciliation are recorded.
 *
 * - Money received makes a customer: a successful payment, or a checkout
 *   whose payment is already collected (`payment_status: 'paid'`). A
 *   subscription start and an asynchronous checkout completion are not money.
 * - A subscription cancellation or a full refund may make a former customer.
 */
export async function applyCustomerStage(
  tx: Tx,
  event: StageEvent,
  contactId: string,
  reconciliation: StageReconciliation | null,
): Promise<CustomerStageResult | null> {
  const at = eventOccurredAt(event.raw)
  if (isMoneyReceived(event)) return markCustomer(tx, contactId, at)

  const cancelled = SUBSCRIPTION_CANCELLED_EVENT_TYPES.has(event.eventType)
  if (!cancelled && !isFullRefund(event, reconciliation)) return null
  return markFormerCustomer(tx, contactId, at, {
    orderId: reconciliation?.orderId ?? event.orderId,
    subscriptionId: cancelled ? event.subscriptionId : null,
  })
}

export function isMoneyReceived(event: Pick<StageEvent, 'eventType' | 'raw'>): boolean {
  return isMoneyReceivedEvent(event.eventType, checkoutPaymentStatus(event.raw))
}

/**
 * The checkout's `payment_status` as the sender states it: Stripe-native
 * (`data.object.payment_status`) or the relay (`data.payment_status`).
 */
export function checkoutPaymentStatus(raw: Record<string, unknown>): string | null {
  const data = asRecord(raw.data)
  const stated = [asRecord(data.object).payment_status, data.payment_status].filter(
    (status): status is string => typeof status === 'string',
  )
  return stated.includes('paid') ? 'paid' : (stated[0] ?? null)
}

/**
 * When the event happened, as the sender states it: Stripe's `created` (Unix
 * seconds) or the relay's `timestamp` (ISO 8601); the receipt time otherwise.
 */
export function eventOccurredAt(raw: Record<string, unknown>, now: Date = new Date()): Date {
  if (typeof raw.created === 'number' && Number.isFinite(raw.created)) {
    return new Date(raw.created * 1000)
  }
  if (typeof raw.timestamp === 'string') {
    const parsed = Date.parse(raw.timestamp)
    if (!Number.isNaN(parsed)) return new Date(parsed)
  }
  return now
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

import { createHash } from 'node:crypto'
import type { DhanamPaymentLifecycle } from '@phynd/services/payments/payment-reconciliation'

interface PaymentLifecycleEvent {
  amountMinor: number | null
  currency: string | null
  eventType: string
}

export const STRIPE_PAID_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'invoice.payment_succeeded',
  'payment.succeeded',
  'subscription.created',
])

const PAYMENT_FAILED_EVENT_TYPES = new Set([
  'invoice.payment_failed',
  'payment.failed',
  'payment_intent.payment_failed',
])

const PAYMENT_REFUNDED_EVENT_TYPES = new Set([
  'charge.refunded',
  'invoice.payment_refunded',
  'payment.refunded',
  'refund.created',
  'refund.succeeded',
])

const PAYMENT_DISPUTED_EVENT_TYPES = new Set([
  'charge.dispute.created',
  'charge.dispute.updated',
  'dispute.created',
  'payment.dispute.created',
  'payment.disputed',
])

const PAYMENT_CANCELLED_EVENT_TYPES = new Set([
  'checkout.session.expired',
  'invoice.voided',
  'payment.cancelled',
  'payment.canceled',
  'payment_intent.canceled',
])

export function classifyPaymentLifecycle(eventType: string): DhanamPaymentLifecycle | null {
  if (STRIPE_PAID_EVENT_TYPES.has(eventType)) return 'paid'
  if (PAYMENT_FAILED_EVENT_TYPES.has(eventType)) return 'failed'
  if (PAYMENT_REFUNDED_EVENT_TYPES.has(eventType)) return 'refunded'
  if (PAYMENT_DISPUTED_EVENT_TYPES.has(eventType)) return 'disputed'
  if (PAYMENT_CANCELLED_EVENT_TYPES.has(eventType)) return 'cancelled'
  return null
}

export function engagementEventStatus(eventType: string) {
  const lifecycle = classifyPaymentLifecycle(eventType)
  if (lifecycle === 'paid') return 'milestone'
  if (lifecycle === 'failed' || lifecycle === 'cancelled') return 'failed'
  if (lifecycle === 'refunded' || lifecycle === 'disputed') return 'blocked'
  return null
}

export function conversionValue(event: PaymentLifecycleEvent) {
  if (event.amountMinor == null) return null
  if (STRIPE_PAID_EVENT_TYPES.has(event.eventType)) return (event.amountMinor / 100).toFixed(2)
  if (PAYMENT_REFUNDED_EVENT_TYPES.has(event.eventType)) {
    return (-(event.amountMinor / 100)).toFixed(2)
  }
  return null
}

export function buildEngagementMessage(event: PaymentLifecycleEvent): string {
  if (STRIPE_PAID_EVENT_TYPES.has(event.eventType)) {
    if (event.amountMinor != null && event.currency) {
      const major = (event.amountMinor / 100).toFixed(2)
      return `Payment received: ${event.currency} ${major}`
    }
    return 'Payment received'
  }
  if (PAYMENT_FAILED_EVENT_TYPES.has(event.eventType)) return 'Payment failed'
  if (PAYMENT_REFUNDED_EVENT_TYPES.has(event.eventType)) return 'Payment refunded'
  if (PAYMENT_DISPUTED_EVENT_TYPES.has(event.eventType)) return 'Payment disputed'
  if (PAYMENT_CANCELLED_EVENT_TYPES.has(event.eventType)) return 'Payment cancelled'
  return `Billing event: ${event.eventType}`
}

/** `conversions.type` is varchar(30): no mapped value may be longer. */
export const CONVERSION_TYPE_MAX_LENGTH = 30

/**
 * `conversions.type` per Dhanam event type, explicit for every type the route
 * classifies and every type the sender emits. Analytics queries and the derived
 * customer health (`@phynd/services` `customer-health.ts`) filter on these
 * values, so the names already stored stay as they were (`dhanam_` + the event
 * type, when that fits). Types whose generic name would not fit the column get
 * a short name here; equivalent Stripe-native and relay types share one.
 */
export const DHANAM_CONVERSION_TYPES: Readonly<Record<string, string>> = {
  // Paid.
  'checkout.session.completed': 'dhanam_checkout_completed',
  'customer.subscription.created': 'dhanam_subscription_created',
  'subscription.created': 'dhanam_subscription_created',
  'invoice.payment_succeeded': 'dhanam_payment_succeeded',
  'payment.succeeded': 'dhanam_payment_succeeded',
  // Failed.
  'invoice.payment_failed': 'dhanam_invoice_payment_failed',
  'payment.failed': 'dhanam_payment_failed',
  'payment_intent.payment_failed': 'dhanam_payment_failed',
  // Refunded.
  'charge.refunded': 'dhanam_charge_refunded',
  'invoice.payment_refunded': 'dhanam_invoice_refunded',
  'payment.refunded': 'dhanam_payment_refunded',
  'refund.created': 'dhanam_refund_created',
  'refund.succeeded': 'dhanam_refund_succeeded',
  // Disputed.
  'charge.dispute.created': 'dhanam_charge_dispute_created',
  'charge.dispute.updated': 'dhanam_charge_dispute_updated',
  'charge.dispute.closed': 'dhanam_charge_dispute_closed',
  'charge.dispute.funds_withdrawn': 'dhanam_dispute_funds_withdrawn',
  'charge.dispute.funds_reinstated': 'dhanam_dispute_reinstated',
  'dispute.created': 'dhanam_dispute_created',
  'payment.dispute.created': 'dhanam_payment_dispute_created',
  'payment.disputed': 'dhanam_payment_disputed',
  // Cancelled payments.
  'checkout.session.expired': 'dhanam_checkout_expired',
  'invoice.voided': 'dhanam_invoice_voided',
  'payment.cancelled': 'dhanam_payment_cancelled',
  'payment.canceled': 'dhanam_payment_canceled',
  'payment_intent.canceled': 'dhanam_payment_intent_canceled',
  // Subscription lifecycle.
  'customer.subscription.updated': 'dhanam_subscription_updated',
  'subscription.updated': 'dhanam_subscription_updated',
  'customer.subscription.deleted': 'dhanam_subscription_deleted',
  'subscription.deleted': 'dhanam_subscription_deleted',
  'subscription.cancelled': 'dhanam_subscription_cancelled',
  'subscription.canceled': 'dhanam_subscription_canceled',
  'subscription.expired': 'dhanam_subscription_expired',
  'subscription.paused': 'dhanam_subscription_paused',
  'subscription.resumed': 'dhanam_subscription_resumed',
  // Other events the sender emits.
  'payment_intent.succeeded': 'dhanam_intent_succeeded',
  'invoice.paid': 'dhanam_invoice_paid',
  'charge.paid': 'dhanam_charge_paid',
  'charge.declined': 'dhanam_charge_declined',
  'payment.pending': 'dhanam_payment_pending',
  'customer.created': 'dhanam_customer_created',
  'customer.updated': 'dhanam_customer_updated',
}

/**
 * `conversions.type` of a Dhanam event: the explicit name above, else
 * `dhanam_` + the event type with other characters as `_`, else (when that
 * would not fit the column) a deterministic short form: the start of that name
 * and a hash of the full event type. Never longer than the column.
 */
export function mapEventTypeToConversionType(eventType: string): string {
  const mapped = DHANAM_CONVERSION_TYPES[eventType]
  if (mapped) return mapped
  const generic = `dhanam_${eventType.replace(/[^a-z0-9_]+/gi, '_')}`
  if (generic.length <= CONVERSION_TYPE_MAX_LENGTH) return generic
  const hash = createHash('sha256').update(eventType).digest('hex').slice(0, 8)
  return `${generic.slice(0, CONVERSION_TYPE_MAX_LENGTH - hash.length - 1)}_${hash}`
}

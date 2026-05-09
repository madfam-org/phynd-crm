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

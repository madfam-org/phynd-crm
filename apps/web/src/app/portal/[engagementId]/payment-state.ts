import { type PortalCopy, formatPortalMoney, portalCopy } from '@/lib/portal/copy'

export type CheckoutErrorCode =
  | 'checkout_failed'
  | 'missing_quote'
  | 'provider_unavailable'
  | 'quote_not_found'
  | 'quote_not_payable'

export type CheckoutNoticeCode = 'cancelled' | 'success'

export type PortalPaymentAction =
  | 'accept_and_pay'
  | 'awaiting_review'
  | 'paid'
  | 'pay_now'
  | 'retry'

export interface PortalPaymentStateInput {
  checkoutError?: string | null
  checkoutNotice?: string | null
  currency?: string | null
  paidAmount?: string | null
  paymentStatus: string
  quoteStatus: string
  totalAmount?: string | null
}

export function portalPaymentAction(input: PortalPaymentStateInput): PortalPaymentAction {
  if (input.paymentStatus === 'paid') return 'paid'
  if (
    ['failed', 'cancelled', 'unpaid', 'partial', 'partial_refund'].includes(input.paymentStatus)
  ) {
    if (input.quoteStatus === 'accepted') return 'retry'
    if (input.quoteStatus === 'sent') return 'accept_and_pay'
  }
  if (input.quoteStatus === 'accepted') return 'pay_now'
  if (input.quoteStatus === 'sent') return 'accept_and_pay'
  return 'awaiting_review'
}

export function paymentStateMessage(
  input: PortalPaymentStateInput,
  copy: PortalCopy = portalCopy('usted'),
) {
  if (input.checkoutError) return checkoutErrorMessage(input.checkoutError, copy)
  if (input.checkoutNotice) return checkoutNoticeMessage(input.checkoutNotice, copy)

  if (input.paymentStatus === 'partial' || input.paymentStatus === 'partial_refund') {
    const remaining = remainingBalance(input.totalAmount, input.paidAmount, input.currency)
    return remaining ? copy.partialWithBalance(remaining) : copy.partialChecking
  }
  if (input.paymentStatus === 'failed') return copy.payment.failed
  if (input.paymentStatus === 'cancelled') return copy.payment.cancelled
  if (input.paymentStatus === 'disputed') return copy.payment.disputed
  if (input.paymentStatus === 'refunded') return copy.payment.refunded
  if (input.paymentStatus === 'paid') return copy.payment.paid
  return null
}

export function checkoutErrorMessage(code: string, copy: PortalCopy = portalCopy('usted')) {
  const known: CheckoutErrorCode[] = [
    'checkout_failed',
    'missing_quote',
    'provider_unavailable',
    'quote_not_found',
    'quote_not_payable',
  ]
  const key = known.includes(code as CheckoutErrorCode) ? code : 'checkout_failed'
  return copy.checkoutErrors[key] ?? copy.checkoutErrors.checkout_failed ?? null
}

export function checkoutNoticeMessage(code: string, copy: PortalCopy = portalCopy('usted')) {
  const known: CheckoutNoticeCode[] = ['cancelled', 'success']
  return known.includes(code as CheckoutNoticeCode) ? (copy.checkoutNotices[code] ?? null) : null
}

function remainingBalance(
  totalAmount?: string | null,
  paidAmount?: string | null,
  currency?: string | null,
) {
  const total = parseAmount(totalAmount)
  const paid = parseAmount(paidAmount)
  if (total == null || paid == null) return null
  return formatPortalMoney(Math.max(total - paid, 0), currency || 'MXN')
}

function parseAmount(value?: string | null) {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

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

export function paymentStateMessage(input: PortalPaymentStateInput) {
  if (input.checkoutError) return checkoutErrorMessage(input.checkoutError)
  if (input.checkoutNotice) return checkoutNoticeMessage(input.checkoutNotice)

  if (input.paymentStatus === 'partial' || input.paymentStatus === 'partial_refund') {
    const remaining = remainingBalance(input.totalAmount, input.paidAmount, input.currency)
    return remaining
      ? `Partial payment received. Remaining balance: ${remaining}.`
      : 'Partial payment received. We are verifying the remaining balance.'
  }
  if (input.paymentStatus === 'failed') return 'Payment failed. You can retry checkout.'
  if (input.paymentStatus === 'cancelled') return 'Checkout was cancelled. You can restart payment.'
  if (input.paymentStatus === 'disputed') {
    return 'Payment is under review. Our team will contact you with next steps.'
  }
  if (input.paymentStatus === 'refunded') {
    return 'Payment was refunded. Our team will contact you with next steps.'
  }
  if (input.paymentStatus === 'paid')
    return 'Payment received. Your project is ready for production.'
  return null
}

export function checkoutErrorMessage(code: string) {
  const messages: Record<CheckoutErrorCode, string> = {
    checkout_failed: 'Checkout could not be created. Please retry or contact the team.',
    missing_quote: 'Choose a quote before starting checkout.',
    provider_unavailable: 'Payment provider is temporarily unavailable. Please retry shortly.',
    quote_not_found: 'This quote is no longer available for this portal.',
    quote_not_payable: 'This quote is not currently payable. Please contact the team.',
  }
  return messages[code as CheckoutErrorCode] ?? messages.checkout_failed
}

export function checkoutNoticeMessage(code: string) {
  const messages: Record<CheckoutNoticeCode, string> = {
    cancelled: 'Checkout was cancelled before payment was completed.',
    success: 'Checkout completed. Payment confirmation may take a moment to appear.',
  }
  return messages[code as CheckoutNoticeCode] ?? null
}

function remainingBalance(
  totalAmount?: string | null,
  paidAmount?: string | null,
  currency?: string | null,
) {
  const total = parseAmount(totalAmount)
  const paid = parseAmount(paidAmount)
  if (total == null || paid == null) return null
  const remaining = Math.max(total - paid, 0)
  return new Intl.NumberFormat('en-US', {
    currency: currency || 'USD',
    style: 'currency',
  }).format(remaining)
}

function parseAmount(value?: string | null) {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

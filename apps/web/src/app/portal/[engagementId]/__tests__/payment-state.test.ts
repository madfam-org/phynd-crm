import { describe, expect, it } from 'vitest'
import { paymentStateMessage, portalPaymentAction } from '../payment-state'

describe('portal payment state', () => {
  it('allows retry for failed accepted quotes', () => {
    expect(portalPaymentAction({ paymentStatus: 'failed', quoteStatus: 'accepted' })).toBe('retry')
  })

  it('shows partial payment remaining balance', () => {
    expect(
      paymentStateMessage({
        currency: 'MXN',
        paidAmount: '100.00',
        paymentStatus: 'partial',
        quoteStatus: 'accepted',
        totalAmount: '420.00',
      }),
    ).toBe('Partial payment received. Remaining balance: MX$320.00.')
  })

  it('maps checkout provider errors to client-safe copy', () => {
    expect(
      paymentStateMessage({
        checkoutError: 'provider_unavailable',
        paymentStatus: 'unpaid',
        quoteStatus: 'accepted',
      }),
    ).toBe('Payment provider is temporarily unavailable. Please retry shortly.')
  })
})

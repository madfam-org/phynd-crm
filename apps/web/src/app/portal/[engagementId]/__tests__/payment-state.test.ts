import { portalCopy } from '@/lib/portal/copy'
import { describe, expect, it } from 'vitest'
import { paymentStateMessage, portalPaymentAction } from '../payment-state'

describe('portal payment state', () => {
  it('allows retry for failed accepted quotes', () => {
    expect(portalPaymentAction({ paymentStatus: 'failed', quoteStatus: 'accepted' })).toBe('retry')
  })

  it('shows partial payment remaining balance in es-MX money', () => {
    expect(
      paymentStateMessage({
        currency: 'MXN',
        paidAmount: '100.00',
        paymentStatus: 'partial',
        quoteStatus: 'accepted',
        totalAmount: '420.00',
      }),
    ).toBe('Recibimos un pago parcial. Saldo pendiente: $320.00.')
  })

  it('maps checkout provider errors to client-safe copy in the reader register', () => {
    const input = {
      checkoutError: 'provider_unavailable',
      paymentStatus: 'unpaid',
      quoteStatus: 'accepted',
    }
    expect(paymentStateMessage(input, portalCopy('usted'))).toBe(
      'El servicio de pagos no está disponible. Intente más tarde.',
    )
    expect(paymentStateMessage(input, portalCopy('tu'))).toBe(
      'El servicio de pagos no está disponible. Intenta más tarde.',
    )
  })

  it('falls back to the generic checkout error for unknown codes', () => {
    expect(
      paymentStateMessage({ checkoutError: 'weird', paymentStatus: 'unpaid', quoteStatus: 'sent' }),
    ).toBe('No pudimos iniciar el pago. Intente de nuevo en un momento.')
  })

  it('addresses the paid state in usted by default', () => {
    expect(paymentStateMessage({ paymentStatus: 'paid', quoteStatus: 'accepted' })).toBe(
      'Pago recibido. Su proyecto está listo para producción.',
    )
  })
})

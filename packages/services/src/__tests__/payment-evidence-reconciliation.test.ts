import { describe, expect, it } from 'vitest'
import {
  describeBalance,
  orderPaymentStatus,
  reconcile,
  toCents,
} from '../payment-evidence/reconciliation'

const pay = (amount: string, status = 'recorded', currency = 'MXN') => ({
  amount,
  currency,
  status,
})

describe('reconciliation', () => {
  it('reports an overpayment as saldo a favor', () => {
    const r = reconcile({
      due: '11600.00',
      dueCurrency: 'MXN',
      payments: [pay('11603.56', 'verified')],
    })
    expect(r).toMatchObject({ state: 'overpaid', differenceCents: 356, verifiedCents: 1160356 })
    expect(describeBalance(r)).toBe('+$3.56 saldo a favor')
  })

  it('reports a partial payment with what is still owed', () => {
    const r = reconcile({
      due: '11600.00',
      dueCurrency: 'MXN',
      payments: [pay('5000.00', 'verified'), pay('1000.10')],
    })
    expect(r).toMatchObject({
      state: 'partial',
      receivedCents: 600010,
      verifiedCents: 500000,
      differenceCents: -559990,
    })
    expect(describeBalance(r)).toBe('Pago parcial, faltan $5,599.90')
  })

  it('sums in cents (no float drift) and recognises an exact payment', () => {
    const r = reconcile({ due: '0.30', dueCurrency: 'MXN', payments: [pay('0.10'), pay('0.20')] })
    expect(r.state).toBe('paid')
    expect(describeBalance(r)).toBe('Pagado completo')
  })

  it('never counts voided payments or another currency', () => {
    const r = reconcile({
      due: '100.00',
      dueCurrency: 'MXN',
      payments: [pay('100.00', 'voided'), pay('100.00', 'verified', 'USD')],
    })
    expect(r).toMatchObject({ state: 'unpaid', receivedCents: 0, otherCurrencyCount: 1 })
    expect(describeBalance(r)).toBe('Sin pagos; por cobrar $100.00')
  })

  it('has no balance without a quote or order', () => {
    const r = reconcile({ due: null, dueCurrency: 'MXN', payments: [pay('10.00')] })
    expect(r.state).toBe('no_target')
    expect(describeBalance(r)).toBe('Sin cotización ni pedido ligado')
  })

  it('derives the order payment status like the Dhanam reconciliation', () => {
    expect(orderPaymentStatus(0, 1000)).toBe('unpaid')
    expect(orderPaymentStatus(500, 1000)).toBe('partial')
    expect(orderPaymentStatus(1000, 1000)).toBe('paid')
    expect(orderPaymentStatus(1001, 1000)).toBe('paid')
    expect(toCents('11603.56')).toBe(1160356)
  })
})

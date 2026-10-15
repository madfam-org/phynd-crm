/**
 * Amount due versus received for a quote or order. All math in integer cents.
 *
 * received counts every evidence that is not voided (recorded or verified) in
 * the target's currency; verified is reported separately. Evidence in another
 * currency is never added: it is counted in `otherCurrencyCount` for staff.
 */

export type BalanceState = 'no_target' | 'unpaid' | 'partial' | 'paid' | 'overpaid'

export interface ReconciliationInput {
  due: string | null
  dueCurrency: string
  payments: Array<{ amount: string; currency: string; status: string }>
}

export interface Reconciliation {
  state: BalanceState
  currency: string
  dueCents: number | null
  receivedCents: number
  verifiedCents: number
  /** received − due; positive = saldo a favor, negative = still owed. */
  differenceCents: number | null
  otherCurrencyCount: number
}

export function toCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export const fromCents = (cents: number) => (cents / 100).toFixed(2)

export function reconcile(input: ReconciliationInput): Reconciliation {
  const currency = input.dueCurrency.toUpperCase()
  let receivedCents = 0
  let verifiedCents = 0
  let otherCurrencyCount = 0
  for (const p of input.payments) {
    if (p.status === 'voided') continue
    if (p.currency.toUpperCase() !== currency) {
      otherCurrencyCount++
      continue
    }
    const cents = toCents(p.amount) ?? 0
    receivedCents += cents
    if (p.status === 'verified') verifiedCents += cents
  }
  const dueCents = toCents(input.due)
  if (dueCents === null) {
    return {
      state: 'no_target',
      currency,
      dueCents,
      receivedCents,
      verifiedCents,
      differenceCents: null,
      otherCurrencyCount,
    }
  }
  const differenceCents = receivedCents - dueCents
  const state: BalanceState =
    receivedCents === 0
      ? 'unpaid'
      : differenceCents < 0
        ? 'partial'
        : differenceCents === 0
          ? 'paid'
          : 'overpaid'
  return {
    state,
    currency,
    dueCents,
    receivedCents,
    verifiedCents,
    differenceCents,
    otherCurrencyCount,
  }
}

export function formatMxMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(cents / 100)
}

/** Staff-facing Spanish summary, e.g. "+$3.56 saldo a favor" or "pago parcial, faltan $X". */
export function describeBalance(r: Reconciliation): string {
  const money = (cents: number) => formatMxMoney(cents, r.currency)
  switch (r.state) {
    case 'no_target':
      return 'Sin cotización ni pedido ligado'
    case 'unpaid':
      return `Sin pagos; por cobrar ${money(r.dueCents ?? 0)}`
    case 'partial':
      return `Pago parcial, faltan ${money(-(r.differenceCents ?? 0))}`
    case 'paid':
      return 'Pagado completo'
    case 'overpaid':
      return `+${money(r.differenceCents ?? 0)} saldo a favor`
  }
}

/** Order payment status for a paid amount, same rule as the Dhanam reconciliation. */
export function orderPaymentStatus(paidCents: number, totalCents: number | null): string {
  if (totalCents === null) return paidCents > 0 ? 'paid' : 'unpaid'
  if (paidCents >= totalCents) return 'paid'
  return paidCents > 0 ? 'partial' : 'unpaid'
}

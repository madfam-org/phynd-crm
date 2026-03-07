import type { DhanamBilling } from '@phyne/types/federation'
import type { FederationProvider } from '../../core/types'

interface DhanamRawCustomer {
  id: string
  subscription: { plan: string; status: string }
  balance: { amount: number; currency: string }
  invoices: Array<{
    id: string
    amount: number
    currency: string
    status: string
    created_at: string
    paid_at: string | null
  }>
  payment_methods: Array<{
    id: string
    type: string
    last_four: string
    is_default: boolean
  }>
}

export class DhanamProvider implements FederationProvider<DhanamRawCustomer, DhanamBilling> {
  readonly name = 'dhanam' as const
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async fetch(externalId: string, token: string): Promise<DhanamRawCustomer> {
    const response = await fetch(`${this.baseUrl}/api/v1/customers/${externalId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw Object.assign(new Error(`Dhanam API error: ${response.statusText}`), {
        status: response.status,
      })
    }

    return response.json() as Promise<DhanamRawCustomer>
  }

  map(raw: DhanamRawCustomer): DhanamBilling {
    return {
      customerId: raw.id,
      plan: raw.subscription.plan,
      status: raw.subscription.status,
      currentBalance: raw.balance.amount,
      currency: raw.balance.currency,
      invoices: raw.invoices.map((inv) => ({
        id: inv.id,
        amount: inv.amount,
        currency: inv.currency,
        status: inv.status,
        issuedAt: new Date(inv.created_at),
        paidAt: inv.paid_at ? new Date(inv.paid_at) : null,
      })),
      paymentMethods: raw.payment_methods.map((pm) => ({
        id: pm.id,
        type: pm.type,
        last4: pm.last_four,
        isDefault: pm.is_default,
      })),
    }
  }

  getCacheKey(externalId: string, _tenantId: string): string {
    return externalId
  }
}

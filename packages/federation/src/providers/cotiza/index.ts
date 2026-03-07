import type { CotizaManufacturing } from '@phyne/types/federation'
import type { FederationProvider } from '../../core/types'

interface CotizaRawData {
  orders: Array<{
    id: string
    status: string
    product_name: string
    quantity: number
    estimated_completion: string | null
    progress_pct: number
    created_at: string
  }>
  quotes: Array<{
    id: string
    status: string
    total: number
    currency: string
    valid_until: string
    created_at: string
  }>
}

export class CotizaProvider implements FederationProvider<CotizaRawData, CotizaManufacturing> {
  readonly name = 'cotiza' as const
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async fetch(externalId: string, token: string): Promise<CotizaRawData> {
    const response = await fetch(`${this.baseUrl}/api/v1/clients/${externalId}/summary`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      throw Object.assign(new Error(`Cotiza API error: ${response.statusText}`), {
        status: response.status,
      })
    }

    return response.json() as Promise<CotizaRawData>
  }

  map(raw: CotizaRawData): CotizaManufacturing {
    return {
      orders: raw.orders.map((o) => ({
        id: o.id,
        status: o.status,
        productName: o.product_name,
        quantity: o.quantity,
        estimatedCompletion: o.estimated_completion ? new Date(o.estimated_completion) : null,
        progress: o.progress_pct,
        createdAt: new Date(o.created_at),
      })),
      activeQuotes: raw.quotes.map((q) => ({
        id: q.id,
        status: q.status,
        totalAmount: q.total,
        currency: q.currency,
        validUntil: new Date(q.valid_until),
        createdAt: new Date(q.created_at),
      })),
    }
  }

  getCacheKey(externalId: string, _tenantId: string): string {
    return externalId
  }
}

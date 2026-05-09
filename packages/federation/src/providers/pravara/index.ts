import type { PravaraFabrication, PravaraOrderStatus } from '@phynd/types/federation'
import type { FederationProvider } from '../../core/types'

interface PravaraRawOrder {
  order_id: string
  cotiza_order_id?: string
  status: PravaraOrderStatus
  product_name: string
  quantity: number
  started_at: string
  estimated_completion: string
  completed_at?: string
  current_step: string
  total_steps: number
  completed_steps: number
  notes?: string
}

interface PravaraRawData {
  orders: PravaraRawOrder[]
  summary: {
    total: number
    in_progress: number
    completed: number
    delayed: number
  }
}

export class PravaraProvider implements FederationProvider<PravaraRawData, PravaraFabrication> {
  readonly name = 'pravara' as const
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async fetch(externalId: string, token: string, signal?: AbortSignal): Promise<PravaraRawData> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/fabrication/orders?contactId=${encodeURIComponent(externalId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: signal ?? AbortSignal.timeout(10000),
      },
    )

    if (!response.ok) {
      throw Object.assign(new Error(`PravaraMES API error: ${response.statusText}`), {
        status: response.status,
      })
    }

    return response.json() as Promise<PravaraRawData>
  }

  map(raw: PravaraRawData): PravaraFabrication {
    return {
      orders: raw.orders.map((o) => ({
        orderId: o.order_id,
        cotizaOrderId: o.cotiza_order_id,
        status: o.status,
        productName: o.product_name,
        quantity: o.quantity,
        startedAt: o.started_at,
        estimatedCompletion: o.estimated_completion,
        completedAt: o.completed_at,
        currentStep: o.current_step,
        totalSteps: o.total_steps,
        completedSteps: o.completed_steps,
        notes: o.notes,
      })),
      summary: {
        total: raw.summary.total,
        inProgress: raw.summary.in_progress,
        completed: raw.summary.completed,
        delayed: raw.summary.delayed,
      },
    }
  }

  getCacheKey(externalId: string, _tenantId: string): string {
    return externalId
  }
}

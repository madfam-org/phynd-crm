import { describe, expect, it, vi } from 'vitest'
import {
  dispatchPendingProductionDispatches,
  dispatchProductionDispatchReference,
} from '../production/production-dispatch-http.service'

describe('production dispatch HTTP service', () => {
  it('dispatches a Pravara production intent and records success', async () => {
    const { db, state } = createDispatchDb([
      productionReference({
        id: 'ref-pravara-001',
        provider: 'pravara',
        externalId: 'order-001:fabrication',
        metadata: {
          dispatch_status: 'requested',
          engagement_id: 'eng-001',
          order_id: 'order-001',
          quote_id: 'quote-001',
          payment_event_id: 'evt-001',
          payment_reference: 'pi-001',
          track: 'fabrication',
        },
      }),
    ])
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ dispatch_id: 'pravara-dispatch-001' }), { status: 202 }),
      )

    const result = await dispatchProductionDispatchReference(db as never, 'ref-pravara-001', {
      env: {
        PRAVARA_API_KEY: 'pravara-key',
        PRAVARA_BASE_URL: 'https://pravara.test',
      },
      fetcher,
      now: new Date('2026-05-07T23:00:00.000Z'),
    })

    expect(result).toEqual({
      provider: 'pravara',
      referenceId: 'ref-pravara-001',
      status: 'sent',
    })
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, request] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://pravara.test/api/v1/fabrication/dispatches')
    expect(request.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer pravara-key',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'production-dispatch:ref-pravara-001',
      }),
    )
    expect(JSON.parse(String(request.body))).toEqual(
      expect.objectContaining({
        type: 'production.dispatch.requested',
        data: expect.objectContaining({
          dispatch_id: 'ref-pravara-001',
          engagement_id: 'eng-001',
          order_id: 'order-001',
          payment_reference: 'pi-001',
          track: 'fabrication',
        }),
      }),
    )
    expect(state.updates[0]?.metadata).toEqual(
      expect.objectContaining({
        dispatch_status: 'sent',
        provider_response_id: 'pravara-dispatch-001',
      }),
    )
    expect(state.events[0]).toEqual(
      expect.objectContaining({
        engagementId: 'eng-001',
        eventType: 'system:production_dispatch_sent',
        status: 'completed',
        dedupKey: 'dispatch:order-001:fabrication:sent',
      }),
    )
  })

  it('dispatches a Selva production intent with HMAC headers', async () => {
    const { db, state } = createDispatchDb([
      productionReference({
        id: 'ref-selva-001',
        provider: 'selva',
        externalId: 'order-001:digital_twin',
        metadata: {
          dispatch_status: 'requested',
          engagement_id: 'eng-001',
          order_id: 'order-001',
          track: 'digital_twin',
        },
      }),
    ])
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))

    const summary = await dispatchPendingProductionDispatches(db as never, {
      env: {
        SELVA_API_URL: 'https://selva.test',
        SELVA_DISPATCH_SECRET: 'selva-secret',
      },
      fetcher,
      now: new Date('2026-05-07T23:00:00.000Z'),
    })

    expect(summary).toEqual({ failed: 0, scanned: 1, sent: 1, skipped: 0 })
    const [url, request] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://selva.test/api/v1/projects/dispatches')
    expect(request.headers).toEqual(
      expect.objectContaining({
        'X-Webhook-Timestamp': '2026-05-07T23:00:00.000Z',
      }),
    )
    expect((request.headers as Record<string, string>)['X-PhyneCRM-Signature']).toMatch(/^sha256=/)
    expect(state.updates[0]?.metadata).toEqual(expect.objectContaining({ dispatch_status: 'sent' }))
  })

  it('marks failed provider responses as retryable', async () => {
    const { db, state } = createDispatchDb([
      productionReference({
        id: 'ref-pravara-002',
        provider: 'pravara',
        externalId: 'order-001:fulfillment',
        metadata: {
          attempt_count: 2,
          dispatch_status: 'requested',
          engagement_id: 'eng-001',
          order_id: 'order-001',
          track: 'fulfillment',
        },
      }),
    ])
    const fetcher = vi.fn().mockResolvedValue(new Response('provider unavailable', { status: 503 }))

    const result = await dispatchProductionDispatchReference(db as never, 'ref-pravara-002', {
      env: {
        PRAVARA_API_KEY: 'pravara-key',
        PRAVARA_BASE_URL: 'https://pravara.test',
      },
      fetcher,
      now: new Date('2026-05-07T23:00:00.000Z'),
    })

    expect(result.status).toBe('failed')
    expect(state.updates[0]?.metadata).toEqual(
      expect.objectContaining({
        attempt_count: 3,
        dispatch_status: 'retry',
        last_error: 'provider unavailable',
        last_status_code: 503,
      }),
    )
    expect(state.events[0]).toEqual(
      expect.objectContaining({
        eventType: 'system:production_dispatch_failed',
        dedupKey: 'dispatch:order-001:fulfillment:failed:3',
      }),
    )
  })

  it('marks network failures as retryable', async () => {
    const { db, state } = createDispatchDb([
      productionReference({
        id: 'ref-pravara-network',
        provider: 'pravara',
        externalId: 'order-001:fabrication',
        metadata: {
          dispatch_status: 'requested',
          engagement_id: 'eng-001',
          order_id: 'order-001',
          track: 'fabrication',
        },
      }),
    ])
    const fetcher = vi.fn().mockRejectedValue(new Error('ECONNRESET'))

    const result = await dispatchProductionDispatchReference(db as never, 'ref-pravara-network', {
      env: {
        PRAVARA_API_KEY: 'pravara-key',
        PRAVARA_BASE_URL: 'https://pravara.test',
      },
      fetcher,
      now: new Date('2026-05-07T23:00:00.000Z'),
    })

    expect(result.status).toBe('failed')
    expect(state.updates[0]?.metadata).toEqual(
      expect.objectContaining({
        dispatch_status: 'retry',
        last_error: 'ECONNRESET',
        last_status_code: 0,
      }),
    )
  })

  it('skips non-requested records', async () => {
    const { db, state } = createDispatchDb([
      productionReference({
        id: 'ref-pravara-003',
        provider: 'pravara',
        externalId: 'order-001:fabrication',
        metadata: {
          dispatch_status: 'sent',
          engagement_id: 'eng-001',
          order_id: 'order-001',
          track: 'fabrication',
        },
      }),
    ])
    const fetcher = vi.fn()

    const summary = await dispatchPendingProductionDispatches(db as never, {
      env: {
        PRAVARA_API_KEY: 'pravara-key',
        PRAVARA_BASE_URL: 'https://pravara.test',
      },
      fetcher,
    })

    expect(summary).toEqual({ failed: 0, scanned: 1, sent: 0, skipped: 1 })
    expect(fetcher).not.toHaveBeenCalled()
    expect(state.updates).toHaveLength(0)
  })
})

function productionReference(overrides: Partial<Record<string, unknown>>) {
  return {
    entityId: 'order-001',
    externalId: 'order-001:fabrication',
    id: 'ref-001',
    metadata: {},
    provider: 'pravara',
    ...overrides,
  }
}

function createDispatchDb(references: Array<Record<string, unknown>>) {
  const state = {
    events: [] as Array<Record<string, unknown>>,
    updates: [] as Array<Record<string, unknown>>,
  }

  const db = {
    insert: vi.fn(() => ({
      values: vi.fn((value: Record<string, unknown>) => {
        state.events.push(value)
        return Promise.resolve([])
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(references)),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: Record<string, unknown>) => {
        state.updates.push(value)
        return {
          where: vi.fn(() => Promise.resolve([])),
        }
      }),
    })),
  }

  return { db, state }
}

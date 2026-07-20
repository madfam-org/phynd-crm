import type { ServiceContext } from '@phynd/services/context'
import type { AuthContext } from '@phynd/types/auth'
import { describe, expect, it, vi } from 'vitest'
import { appRouter } from '../router'
import { createCallerFactory } from '../trpc'

function createMockAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    accessToken: 'tok_test',
    roles: ['admin'],
    scopes: ['*'],
    tenantId: 'madfam',
    userId: 'user-001',
    ...overrides,
  }
}

function createMockCtx(): ServiceContext {
  const qb = {
    _result: [] as unknown[],
    delete: vi.fn(),
    from: vi.fn(),
    groupBy: vi.fn(),
    innerJoin: vi.fn(),
    insert: vi.fn(),
    leftJoin: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
    returning: vi.fn(),
    select: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
    values: vi.fn(),
    where: vi.fn(),
  }

  for (const method of Object.keys(qb).filter((k) => k !== '_result')) {
    ;(qb as unknown as Record<string, ReturnType<typeof vi.fn>>)[method]?.mockReturnValue(qb)
  }

  Object.defineProperty(qb, 'then', {
    value: vi.fn((resolve: (v: unknown) => void) => Promise.resolve(qb._result).then(resolve)),
    configurable: true,
    enumerable: false,
  })

  const db = {
    delete: vi.fn().mockReturnValue(qb),
    insert: vi.fn().mockReturnValue(qb),
    select: vi.fn().mockReturnValue(qb),
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(db)),
    update: vi.fn().mockReturnValue(qb),
  }

  return {
    auth: createMockAuth(),
    cache: {
      delete: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
      invalidate: vi.fn(),
      set: vi.fn(),
    } as unknown as ServiceContext['cache'],
    db: db as unknown as ServiceContext['db'],
    tenantId: 'madfam',
  }
}

describe('analytics router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('dashboardSummary accepts optional date range', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    const result = await caller.analytics.dashboardSummary({
      dateFrom: new Date('2025-01-01'),
      dateTo: new Date('2025-12-31'),
    })
    expect(result).toBeDefined()
  })

  it('dashboardSummary works without date range', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    const result = await caller.analytics.dashboardSummary(undefined)
    expect(result).toBeDefined()
  })

  it('revenueByStatus returns revenue data', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    const result = await caller.analytics.revenueByStatus()
    expect(result).toBeDefined()
  })

  it('weightedPipelineValue returns weighted and raw values', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    const result = await caller.analytics.weightedPipelineValue()
    expect(result).toBeDefined()
    expect(result).toHaveProperty('weightedValue')
    expect(result).toHaveProperty('rawValue')
    expect(result).toHaveProperty('count')
  })

  it('atRiskDeals returns at-risk deals array', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    const result = await caller.analytics.atRiskDeals()
    expect(result).toEqual([])
  })

  it('atRiskDeals accepts optional staleThresholdDays', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    const result = await caller.analytics.atRiskDeals({ staleThresholdDays: 7 })
    expect(result).toBeDefined()
  })

  it('paymentAttributionSummary returns attribution aggregates', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    const result = await caller.analytics.paymentAttributionSummary(undefined)
    expect(result).toBeDefined()
    expect(result).toHaveProperty('totalPayments')
    expect(result).toHaveProperty('byProvider')
    expect(result).toHaveProperty('byCampaign')
  })

  it('signalAttribution returns signal-level attribution rows', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    const result = await caller.analytics.signalAttribution(undefined)
    expect(result).toEqual([])
  })

  it('signalAttribution accepts an optional date range', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    const result = await caller.analytics.signalAttribution({
      dateFrom: new Date('2025-01-01'),
      dateTo: new Date('2025-12-31'),
    })
    expect(result).toBeDefined()
  })
})

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

describe('conversions router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('record accepts valid conversion type', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.conversions.record({
        type: 'visitor_to_lead',
        contactId: '00000000-0000-0000-0000-000000000001',
      }),
    ).resolves.not.toThrow()
  })

  it('record accepts quote acceptance conversions', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.conversions.record({
        type: 'quote_accepted',
        opportunityId: '00000000-0000-0000-0000-000000000001',
        value: '42000.00',
      }),
    ).resolves.not.toThrow()
  })

  it('getByEntity returns conversions for entity', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.conversions.getByEntity({
      entityType: 'lead',
      entityId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toEqual([])
  })

  it('funnelMetrics returns metrics', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.conversions.funnelMetrics()
    expect(result).toBeDefined()
  })
})

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

function createMockCtxWithFederation() {
  const ctx = createMockCtx()
  return {
    ...ctx,
    federation: {
      clients: {} as unknown,
      healthChecker: { checkAll: vi.fn().mockResolvedValue([]) },
    },
  }
}

describe('federation-health router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('status returns health check results', async () => {
    const ctx = createMockCtxWithFederation()
    const caller = createCaller(ctx as unknown as ServiceContext)
    const result = await caller.federationHealth.status()
    expect(result).toEqual({ providers: [] })
    expect(ctx.federation.healthChecker.checkAll).toHaveBeenCalledOnce()
  })

  it('status returns provider data from health checker', async () => {
    const mockProviders = [
      { name: 'janua', status: 'healthy', latency: 42 },
      { name: 'dhanam', status: 'degraded', latency: 200 },
    ]
    const ctx = createMockCtxWithFederation()
    ctx.federation.healthChecker.checkAll.mockResolvedValue(mockProviders)
    const caller = createCaller(ctx as unknown as ServiceContext)
    const result = await caller.federationHealth.status()
    expect(result).toEqual({ providers: mockProviders })
  })

  it('status throws when federation is not available', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(caller.federationHealth.status()).rejects.toThrow(
      'Federation health checker not available in context',
    )
  })
})

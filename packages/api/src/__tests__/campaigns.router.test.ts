import type { ServiceContext } from '@phyne/services/context'
import type { AuthContext } from '@phyne/types/auth'
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

describe('campaigns router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('list returns paginated campaigns', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.campaigns.list({})
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('list accepts cursor and limit', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.campaigns.list({ cursor: 'abc', limit: 5 })
    expect(result).toHaveProperty('items')
    expect(result).toHaveProperty('hasMore')
  })

  it('create accepts valid input', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.campaigns.create({
        name: 'Spring Sale',
        channel: 'email',
        utmSource: 'newsletter',
      }),
    ).resolves.not.toThrow()
  })

  it('update accepts partial fields', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.campaigns.update({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'active',
      }),
    ).resolves.not.toThrow()
  })

  it('delete accepts id', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.campaigns.delete({ id: '00000000-0000-0000-0000-000000000001' }),
    ).resolves.not.toThrow()
  })
})

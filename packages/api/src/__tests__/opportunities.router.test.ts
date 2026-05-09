import type { ServiceContext } from '@phynd/services/context'
import type { AuthContext } from '@phynd/types/auth'
import { describe, expect, it, vi } from 'vitest'
import { appRouter } from '../router'
import { createCallerFactory } from '../trpc'

vi.mock('@phynd/config/features', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}))

vi.mock('@phynd/db/schema', () => ({
  conversions: { id: 'conversions.id', type: 'conversions.type' },
  notifications: { id: 'notifications.id' },
  opportunities: {
    deletedAt: 'opportunities.deletedAt',
    id: 'opportunities.id',
    ownerId: 'opportunities.ownerId',
    status: 'opportunities.status',
  },
  stageTransitions: { id: 'stageTransitions.id' },
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  inArray: vi.fn((col: unknown, vals: unknown[]) => ({ _tag: 'inArray', col, vals })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

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

describe('opportunities router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('list returns paginated opportunities', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.opportunities.list({})
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('list accepts cursor and limit', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.opportunities.list({ cursor: 'abc', limit: 5 })
    expect(result).toHaveProperty('items')
    expect(result).toHaveProperty('hasMore')
  })

  it('list accepts optional ownerId filter', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.opportunities.list({
      ownerId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toHaveProperty('items')
  })

  it('listMine returns opportunities owned by current user', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.opportunities.listMine()
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('listByContactId returns opportunities for a contact', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.opportunities.listByContactId({
      contactId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('create accepts valid input', async () => {
    const ctx = createMockCtx()
    // create() uses tx.insert().values().returning() and accesses opp.id
    const qb = (ctx.db as unknown as { insert: ReturnType<typeof vi.fn> }).insert()
    qb._result = [{ id: 'opp-001', name: 'Big Deal', pipelineId: 'p1', stageId: 's1' }]
    const caller = createCaller(ctx)
    await expect(
      caller.opportunities.create({
        name: 'Big Deal',
        pipelineId: '00000000-0000-0000-0000-000000000001',
        stageId: '00000000-0000-0000-0000-000000000002',
      }),
    ).resolves.not.toThrow()
  })

  it('bulkUpdateStatus accepts up to 100 ids', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const ids = Array.from(
      { length: 5 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    )
    await expect(
      caller.opportunities.bulkUpdateStatus({ ids, status: 'won' }),
    ).resolves.not.toThrow()
  })

  it('bulkUpdateStatus rejects more than 100 ids', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const ids = Array.from(
      { length: 101 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    )
    await expect(caller.opportunities.bulkUpdateStatus({ ids, status: 'won' })).rejects.toThrow()
  })
})

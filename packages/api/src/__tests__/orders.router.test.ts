import type { ServiceContext } from '@phyne/services/context'
import type { AuthContext } from '@phyne/types/auth'
import { describe, expect, it, vi } from 'vitest'
import { appRouter } from '../router'
import { createCallerFactory } from '../trpc'

vi.mock('@phyne/config/features', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}))

vi.mock('@phyne/db/schema', () => ({
  conversions: { id: 'conversions.id', type: 'conversions.type' },
  notifications: { id: 'notifications.id' },
  opportunities: {
    deletedAt: 'opportunities.deletedAt',
    id: 'opportunities.id',
    status: 'opportunities.status',
  },
  orders: {
    contactId: 'orders.contactId',
    deletedAt: 'orders.deletedAt',
    id: 'orders.id',
    opportunityId: 'orders.opportunityId',
    ownerId: 'orders.ownerId',
    quoteId: 'orders.quoteId',
  },
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
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

describe('orders router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('list returns paginated orders', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.orders.list({})
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('list accepts cursor and limit', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.orders.list({ cursor: 'abc', limit: 5 })
    expect(result).toHaveProperty('items')
    expect(result).toHaveProperty('hasMore')
  })

  it('listMine returns orders owned by current user', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.orders.listMine()
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('listByOpportunityId returns orders for an opportunity', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.orders.listByOpportunityId({
      opportunityId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('listByContactId returns orders for a contact', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.orders.listByContactId({
      contactId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('listByQuoteId returns orders for a quote', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.orders.listByQuoteId({
      quoteId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('create accepts valid input', async () => {
    const ctx = createMockCtx()
    const qb = (ctx.db as unknown as { insert: ReturnType<typeof vi.fn> }).insert()
    qb._result = [{ id: 'ord-001', orderNumber: 'ORD-001' }]
    const caller = createCaller(ctx)
    await expect(
      caller.orders.create({ orderNumber: 'ORD-001' }),
    ).resolves.not.toThrow()
  })

  it('update validates status enum', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.orders.update({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'invalid_status' as 'pending',
      }),
    ).rejects.toThrow()
  })
})

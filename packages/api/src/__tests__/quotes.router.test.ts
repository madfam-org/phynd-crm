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
  engagementEvents: { id: 'engagementEvents.id' },
  engagements: {
    contactId: 'engagements.contactId',
    deletedAt: 'engagements.deletedAt',
    id: 'engagements.id',
    opportunityId: 'engagements.opportunityId',
    status: 'engagements.status',
  },
  notifications: { id: 'notifications.id' },
  opportunities: {
    deletedAt: 'opportunities.deletedAt',
    id: 'opportunities.id',
    status: 'opportunities.status',
  },
  orders: {
    deletedAt: 'orders.deletedAt',
    id: 'orders.id',
    quoteId: 'orders.quoteId',
  },
  quotes: {
    contactId: 'quotes.contactId',
    deletedAt: 'quotes.deletedAt',
    id: 'quotes.id',
    opportunityId: 'quotes.opportunityId',
    ownerId: 'quotes.ownerId',
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
    onConflictDoNothing: vi.fn(),
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
    _qb: qb,
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

describe('quotes router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('list returns paginated quotes', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.quotes.list({})
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('list accepts cursor and limit', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.quotes.list({ cursor: 'abc', limit: 5 })
    expect(result).toHaveProperty('items')
    expect(result).toHaveProperty('hasMore')
  })

  it('listMine returns quotes owned by current user', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.quotes.listMine()
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('listByOpportunityId returns quotes for an opportunity', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.quotes.listByOpportunityId({
      opportunityId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('listByContactId returns quotes for a contact', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.quotes.listByContactId({
      contactId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('create accepts valid input', async () => {
    const ctx = createMockCtx()
    const qb = (ctx.db as unknown as { insert: ReturnType<typeof vi.fn> }).insert()
    qb._result = [{ id: 'q-001', quoteNumber: 'Q-001' }]
    const caller = createCaller(ctx)
    await expect(caller.quotes.create({ quoteNumber: 'Q-001' })).resolves.not.toThrow()
  })

  it('create rejects empty quoteNumber', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(caller.quotes.create({ quoteNumber: '' })).rejects.toThrow()
  })

  it('update validates status enum', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.quotes.update({
        id: '00000000-0000-0000-0000-000000000001',
        status: 'invalid_status' as 'draft',
      }),
    ).rejects.toThrow()
  })

  it('accept exposes the quote acceptance lifecycle mutation', async () => {
    const ctx = createMockCtx()
    const db = ctx.db as unknown as { _qb?: { _result: unknown[]; then: ReturnType<typeof vi.fn> } }
    const qb = db._qb
    if (qb) {
      const quote = {
        id: '00000000-0000-0000-0000-000000000001',
        contactId: null,
        opportunityId: null,
        ownerId: null,
        quoteNumber: 'Q-2026-0007',
        status: 'sent',
        totalAmount: '42000.00',
        currency: 'MXN',
        deletedAt: null,
      }
      const acceptedQuote = { ...quote, status: 'accepted' }
      let callCount = 0
      qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        const sequence = [[quote], [acceptedQuote], [], [{ id: 'order-001', quoteId: quote.id }]]
        const result = sequence[callCount] ?? []
        callCount += 1
        return Promise.resolve(result).then(resolve)
      })
    }

    const caller = createCaller(ctx)
    await expect(
      caller.quotes.accept({
        id: '00000000-0000-0000-0000-000000000001',
        source: 'crm',
      }),
    ).resolves.toMatchObject({
      quote: expect.objectContaining({ status: 'accepted' }),
    })
  })
})

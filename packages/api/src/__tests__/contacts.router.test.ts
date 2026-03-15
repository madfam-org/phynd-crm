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

  // Make query builder awaitable
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

describe('contacts router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('list returns paginated contacts', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.contacts.list({})
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('list accepts cursor and limit', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.contacts.list({ cursor: 'abc', limit: 5 })
    expect(result).toHaveProperty('items')
    expect(result).toHaveProperty('hasMore')
  })

  it('listMine returns contacts owned by current user', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.contacts.listMine()
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('list accepts optional ownerId filter', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.contacts.list({
      ownerId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toHaveProperty('items')
  })

  it('bulkCreate creates contacts with valid input', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const input = [
      { email: 'alice@example.com', name: 'Alice' },
      { email: 'bob@example.com', name: 'Bob' },
    ]
    const result = await caller.contacts.bulkCreate(input)
    expect(Array.isArray(result)).toBe(true)
    expect(ctx.db.transaction).toHaveBeenCalled()
  })

  it('bulkCreate rejects empty array', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(caller.contacts.bulkCreate([])).rejects.toThrow()
  })

  it('bulkCreate accepts up to 500 items', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const input = Array.from({ length: 500 }, (_, i) => ({
      name: `Contact ${i}`,
    }))
    await expect(caller.contacts.bulkCreate(input)).resolves.not.toThrow()
  })
})

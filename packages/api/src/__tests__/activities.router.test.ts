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

describe('activities router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('listForEntity accepts entityType and entityId input', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    // Verifies that the input validation passes and the router calls the service
    const result = await caller.activities.listForEntity({
      entityId: '00000000-0000-0000-0000-000000000001',
      entityType: 'contact',
    })
    // Mock DB returns [] which the service wraps into pagination
    expect(result).toBeDefined()
  })

  it('create validates input schema', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    // Should not throw with valid input (even if mock returns empty)
    await expect(
      caller.activities.create({
        entityId: '00000000-0000-0000-0000-000000000001',
        entityType: 'contact',
        title: 'Call prospect',
        type: 'call',
      }),
    ).resolves.not.toThrow()
  })

  it('listMine returns activities owned by current user', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.activities.listMine()
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('list accepts optional ownerId filter', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.activities.list({
      ownerId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toHaveProperty('items')
  })

  it('create accepts quote entityType', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    await expect(
      caller.activities.create({
        entityId: '00000000-0000-0000-0000-000000000001',
        entityType: 'quote',
        title: 'Review quote pricing',
        type: 'task',
      }),
    ).resolves.not.toThrow()
  })

  it('listForEntity accepts order entityType', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.activities.listForEntity({
      entityId: '00000000-0000-0000-0000-000000000001',
      entityType: 'order',
    })
    expect(result).toBeDefined()
  })
})

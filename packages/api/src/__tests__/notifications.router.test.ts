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

describe('notifications router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('list returns notifications for current user', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.notifications.list()
    expect(result).toEqual([])
  })

  it('list accepts unreadOnly and limit options', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.notifications.list({ unreadOnly: true, limit: 5 })
    expect(result).toBeDefined()
  })

  it('unreadCount resolves without error', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.notifications.unreadCount()
    expect(typeof result).toBe('number')
  })

  it('markAsRead accepts a UUID id', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.notifications.markAsRead({
      id: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toBeNull()
  })

  it('markAllAsRead resolves without error', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(caller.notifications.markAllAsRead()).resolves.not.toThrow()
  })

  it('markAsRead rejects invalid id', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(caller.notifications.markAsRead({ id: 'not-a-uuid' })).rejects.toThrow()
  })
})

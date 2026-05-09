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

describe('tags router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('list returns paginated tags', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.tags.list({})
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('list accepts cursor and limit', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.tags.list({ cursor: 'abc', limit: 10 })
    expect(result).toHaveProperty('items')
    expect(result).toHaveProperty('hasMore')
  })

  it('create accepts name and optional color', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    await expect(caller.tags.create({ color: '#ff0000', name: 'VIP' })).resolves.not.toThrow()
  })

  it('create accepts name without color', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    await expect(caller.tags.create({ name: 'Priority' })).resolves.not.toThrow()
  })

  it('delete accepts id', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    await expect(
      caller.tags.delete({ id: '00000000-0000-0000-0000-000000000001' }),
    ).resolves.not.toThrow()
  })

  it('addToEntity accepts tagId, entityType, and entityId', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    await expect(
      caller.tags.addToEntity({
        entityId: '00000000-0000-0000-0000-000000000002',
        entityType: 'contact',
        tagId: '00000000-0000-0000-0000-000000000001',
      }),
    ).resolves.not.toThrow()
  })

  it('removeFromEntity accepts tagId, entityType, and entityId', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    await expect(
      caller.tags.removeFromEntity({
        entityId: '00000000-0000-0000-0000-000000000002',
        entityType: 'lead',
        tagId: '00000000-0000-0000-0000-000000000001',
      }),
    ).resolves.not.toThrow()
  })

  it('getForEntity accepts entityType and entityId', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    const result = await caller.tags.getForEntity({
      entityId: '00000000-0000-0000-0000-000000000002',
      entityType: 'opportunity',
    })
    expect(result).toBeDefined()
    expect(Array.isArray(result)).toBe(true)
  })

  it('addToEntity accepts quote entityType', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    await expect(
      caller.tags.addToEntity({
        entityId: '00000000-0000-0000-0000-000000000002',
        entityType: 'quote',
        tagId: '00000000-0000-0000-0000-000000000001',
      }),
    ).resolves.not.toThrow()
  })

  it('addToEntity accepts order entityType', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    await expect(
      caller.tags.addToEntity({
        entityId: '00000000-0000-0000-0000-000000000002',
        entityType: 'order',
        tagId: '00000000-0000-0000-0000-000000000001',
      }),
    ).resolves.not.toThrow()
  })
})

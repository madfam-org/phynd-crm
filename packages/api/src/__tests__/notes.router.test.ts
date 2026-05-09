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

describe('notes router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('listForEntity accepts entityType and entityId', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.notes.listForEntity({
      entityId: '00000000-0000-0000-0000-000000000001',
      entityType: 'contact',
    })
    expect(result).toBeDefined()
    expect(Array.isArray(result)).toBe(true)
  })

  it('create accepts content, entityType, and entityId', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    await expect(
      caller.notes.create({
        content: 'Follow up on pricing discussion',
        entityId: '00000000-0000-0000-0000-000000000001',
        entityType: 'lead',
      }),
    ).resolves.not.toThrow()
  })

  it('update accepts id and optional content', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    await expect(
      caller.notes.update({
        content: 'Updated note content',
        id: '00000000-0000-0000-0000-000000000001',
      }),
    ).resolves.not.toThrow()
  })

  it('delete accepts id', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    await expect(
      caller.notes.delete({
        id: '00000000-0000-0000-0000-000000000001',
      }),
    ).resolves.not.toThrow()
  })

  it('togglePin accepts id', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    const result = await caller.notes.togglePin({
      id: '00000000-0000-0000-0000-000000000001',
    })
    // togglePin reads then updates; mock returns [] so existing is undefined, returns null
    expect(result).toBeNull()
  })

  it('listForEntity accepts quote entityType', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.notes.listForEntity({
      entityId: '00000000-0000-0000-0000-000000000001',
      entityType: 'quote',
    })
    expect(result).toBeDefined()
    expect(Array.isArray(result)).toBe(true)
  })

  it('create accepts order entityType', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    await expect(
      caller.notes.create({
        content: 'Order fulfillment note',
        entityId: '00000000-0000-0000-0000-000000000001',
        entityType: 'order',
      }),
    ).resolves.not.toThrow()
  })
})

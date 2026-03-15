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

describe('timeline router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('getTimeline returns timeline entries for a lead', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.timeline.getTimeline({
      entityType: 'lead',
      entityId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toEqual([])
  })

  it('getTimeline returns timeline entries for an opportunity', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.timeline.getTimeline({
      entityType: 'opportunity',
      entityId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toEqual([])
  })

  it('getTimeline returns timeline entries for a quote', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.timeline.getTimeline({
      entityType: 'quote',
      entityId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toEqual([])
  })

  it('getTimeline returns timeline entries for an order', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.timeline.getTimeline({
      entityType: 'order',
      entityId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toEqual([])
  })

  it('getTimeline rejects invalid entityId', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.timeline.getTimeline({ entityType: 'lead', entityId: 'not-a-uuid' }),
    ).rejects.toThrow()
  })
})

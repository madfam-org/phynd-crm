import type { ServiceContext } from '@phynd/services/context'
import type { AuthContext } from '@phynd/types/auth'
import { describe, expect, it, vi } from 'vitest'
import { appRouter } from '../router'
import { createCallerFactory } from '../trpc'

vi.mock('@phynd/config/features', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(true),
}))

vi.mock('@phynd/db/schema', () => ({
  leadScores: { id: 'leadScores.id', leadId: 'leadScores.leadId' },
  leadScoringRules: { id: 'leadScoringRules.id' },
  leads: { id: 'leads.id' },
  visitorPageViews: { id: 'visitorPageViews.id', sessionId: 'visitorPageViews.sessionId' },
  visitorSessions: { contactId: 'visitorSessions.contactId', id: 'visitorSessions.id' },
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  count: vi.fn(() => ({ _tag: 'count' })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
  sql: vi.fn(() => ({ _tag: 'sql' })),
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

describe('lead-scoring router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('listRules returns paginated rules', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.leadScoring.listRules({})
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('listRules accepts cursor and limit', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.leadScoring.listRules({ cursor: 'abc', limit: 5 })
    expect(result).toHaveProperty('items')
    expect(result).toHaveProperty('hasMore')
  })

  it('createRule accepts valid input', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.leadScoring.createRule({
        name: 'High-value source',
        category: 'demographic',
        condition: { field: 'source', operator: 'eq', value: 'referral' },
        points: 10,
      }),
    ).resolves.not.toThrow()
  })

  it('updateRule accepts partial fields', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.leadScoring.updateRule({
        id: '00000000-0000-0000-0000-000000000001',
        points: 20,
      }),
    ).resolves.not.toThrow()
  })

  it('deleteRule accepts id', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.leadScoring.deleteRule({ id: '00000000-0000-0000-0000-000000000001' }),
    ).resolves.not.toThrow()
  })

  it('compute accepts leadId and returns score', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.leadScoring.compute({
      leadId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toBeDefined()
  })
})

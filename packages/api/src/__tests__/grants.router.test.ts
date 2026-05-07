import type { ServiceContext } from '@phyne/services/context'
import type { AuthContext } from '@phyne/types/auth'
import { describe, expect, it, vi } from 'vitest'
import { appRouter } from '../router'
import { createCallerFactory } from '../trpc'

const mockIsFeatureEnabled = vi.fn().mockReturnValue(true)

vi.mock('@phyne/config/features', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}))

vi.mock('@phyne/db/schema', () => ({
  grantApplications: {
    complianceChecks: 'grantApplications.complianceChecks',
    deletedAt: 'grantApplications.deletedAt',
    grantOpportunityId: 'grantApplications.grantOpportunityId',
    id: 'grantApplications.id',
    ownerId: 'grantApplications.ownerId',
    status: 'grantApplications.status',
    stageId: 'grantApplications.stageId',
  },
  grantOpportunities: {
    closesAt: 'grantOpportunities.closesAt',
    fortunaGrantId: 'grantOpportunities.fortunaGrantId',
    id: 'grantOpportunities.id',
  },
  grantSignalAudit: {
    createdAt: 'grantSignalAudit.createdAt',
    grantApplicationId: 'grantSignalAudit.grantApplicationId',
    grantOpportunityId: 'grantSignalAudit.grantOpportunityId',
    id: 'grantSignalAudit.id',
  },
  // Also mock other schemas referenced by the router's import chain
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
  asc: vi.fn((col: unknown) => ({ _tag: 'asc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  inArray: vi.fn((col: unknown, vals: unknown[]) => ({ _tag: 'inArray', col, vals })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
  sql: vi.fn(),
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

describe('grants router', () => {
  const createCaller = createCallerFactory(appRouter)

  // -------------------------------------------------------------------------
  // Feature flag gating
  // -------------------------------------------------------------------------
  describe('feature flag gating', () => {
    it('rejects all procedures when treasuryHunter is disabled', async () => {
      mockIsFeatureEnabled.mockReturnValue(false)

      const ctx = createMockCtx()
      const caller = createCaller(ctx)

      await expect(caller.grants.listOpportunities()).rejects.toThrow(
        'Feature not enabled: treasuryHunter',
      )
      await expect(caller.grants.getPipelineStats()).rejects.toThrow(
        'Feature not enabled: treasuryHunter',
      )

      mockIsFeatureEnabled.mockReturnValue(true)
    })
  })

  // -------------------------------------------------------------------------
  // listOpportunities
  // -------------------------------------------------------------------------
  it('listOpportunities returns paginated results', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.grants.listOpportunities()
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('listOpportunities accepts cursor and limit', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.grants.listOpportunities({ cursor: 'abc', limit: 5 })
    expect(result).toHaveProperty('items')
    expect(result).toHaveProperty('hasMore')
  })

  // -------------------------------------------------------------------------
  // getOpportunity
  // -------------------------------------------------------------------------
  it('getOpportunity throws when not found', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.grants.getOpportunity({ id: '00000000-0000-0000-0000-000000000001' }),
    ).rejects.toThrow()
  })

  // -------------------------------------------------------------------------
  // listApplications
  // -------------------------------------------------------------------------
  it('listApplications returns paginated results', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.grants.listApplications()
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('listApplications accepts status filter', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.grants.listApplications({ status: 'draft' })
    expect(result).toHaveProperty('items')
  })

  // -------------------------------------------------------------------------
  // createApplication
  // -------------------------------------------------------------------------
  it('createApplication accepts valid input', async () => {
    const ctx = createMockCtx()
    const qb = (ctx.db as unknown as { insert: ReturnType<typeof vi.fn> }).insert()
    qb._result = [
      {
        id: 'grant-app-001',
        grantOpportunityId: 'g1',
        pipelineId: 'p1',
        stageId: 's1',
        status: 'draft',
      },
    ]
    const caller = createCaller(ctx)
    await expect(
      caller.grants.createApplication({
        grantOpportunityId: '00000000-0000-0000-0000-000000000001',
        pipelineId: '00000000-0000-0000-0000-000000000002',
        stageId: '00000000-0000-0000-0000-000000000003',
      }),
    ).resolves.not.toThrow()
  })

  // -------------------------------------------------------------------------
  // moveToStage
  // -------------------------------------------------------------------------
  it('moveToStage accepts valid input', async () => {
    const ctx = createMockCtx()
    const qb = (ctx.db as unknown as { select: ReturnType<typeof vi.fn> }).select()
    qb._result = [
      {
        id: 'grant-app-001',
        grantOpportunityId: 'g1',
        stageId: 's1',
        deletedAt: null,
        status: 'draft',
      },
    ]
    const caller = createCaller(ctx)
    await expect(
      caller.grants.moveToStage({
        id: '00000000-0000-0000-0000-000000000001',
        stageId: '00000000-0000-0000-0000-000000000002',
      }),
    ).resolves.not.toThrow()
  })

  // -------------------------------------------------------------------------
  // getAuditTrail
  // -------------------------------------------------------------------------
  it('getAuditTrail returns events', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.grants.getAuditTrail({
      opportunityId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toEqual([])
  })

  // -------------------------------------------------------------------------
  // getPipelineStats
  // -------------------------------------------------------------------------
  it('getPipelineStats returns aggregated stats', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.grants.getPipelineStats()
    expect(result).toEqual([])
  })
})

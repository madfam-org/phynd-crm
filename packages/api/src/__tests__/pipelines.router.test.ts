import type { ServiceContext } from '@phyne/services/context'
import type { AuthContext } from '@phyne/types/auth'
import { describe, expect, it, vi } from 'vitest'
import { appRouter } from '../router'
import { createCallerFactory } from '../trpc'

vi.mock('@phyne/db/schema', () => ({
  leads: { pipelineId: 'leads.pipelineId', stageId: 'leads.stageId' },
  opportunities: { pipelineId: 'opportunities.pipelineId', stageId: 'opportunities.stageId' },
  pipelineStages: {
    id: 'pipelineStages.id',
    pipelineId: 'pipelineStages.pipelineId',
    position: 'pipelineStages.position',
  },
  pipelines: { id: 'pipelines.id', isDefault: 'pipelines.isDefault' },
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  asc: vi.fn((col: unknown) => ({ _tag: 'asc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      _tag: 'sql',
      strings,
      values,
    })),
    { join: vi.fn() },
  ),
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

describe('pipelines router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('list returns paginated pipelines', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.pipelines.list({})
    expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
  })

  it('list accepts cursor and limit', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.pipelines.list({ cursor: 'abc', limit: 5 })
    expect(result).toHaveProperty('items')
    expect(result).toHaveProperty('hasMore')
  })

  it('getById returns a pipeline or null', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.pipelines.getById({
      id: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toBeNull()
  })

  it('getStages returns stages for a pipeline', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.pipelines.getStages({
      pipelineId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toEqual([])
  })

  it('getDefault returns the default pipeline or null', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    const result = await caller.pipelines.getDefault()
    expect(result).toBeNull()
  })

  it('create creates a pipeline', async () => {
    const ctx = createMockCtx()
    const qb = (ctx.db as unknown as { insert: ReturnType<typeof vi.fn> }).insert()
    qb._result = [{ id: '00000000-0000-0000-0000-000000000001', name: 'Sales', isDefault: false }]
    const caller = createCaller(ctx)
    const result = await caller.pipelines.create({ name: 'Sales' })
    expect(result).toEqual({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Sales',
      isDefault: false,
    })
  })

  it('create rejects empty name', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(caller.pipelines.create({ name: '' })).rejects.toThrow()
  })

  it('update updates a pipeline', async () => {
    const ctx = createMockCtx()
    const qb = (ctx.db as unknown as { update: ReturnType<typeof vi.fn> }).update()
    qb._result = [{ id: '00000000-0000-0000-0000-000000000001', name: 'Updated', isDefault: true }]
    const caller = createCaller(ctx)
    await expect(
      caller.pipelines.update({
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Updated',
        isDefault: true,
      }),
    ).resolves.not.toThrow()
  })

  it('delete deletes a pipeline', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.pipelines.delete({ id: '00000000-0000-0000-0000-000000000001' }),
    ).resolves.not.toThrow()
  })

  it('createStage creates a stage', async () => {
    const ctx = createMockCtx()
    const qb = (ctx.db as unknown as { insert: ReturnType<typeof vi.fn> }).insert()
    qb._result = [
      {
        id: '00000000-0000-0000-0000-000000000002',
        pipelineId: '00000000-0000-0000-0000-000000000001',
        name: 'Prospecting',
        position: 0,
        probability: 10,
      },
    ]
    const caller = createCaller(ctx)
    const result = await caller.pipelines.createStage({
      pipelineId: '00000000-0000-0000-0000-000000000001',
      name: 'Prospecting',
      position: 0,
      probability: 10,
    })
    expect(result).toHaveProperty('name', 'Prospecting')
  })

  it('createStage rejects negative position', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.pipelines.createStage({
        pipelineId: '00000000-0000-0000-0000-000000000001',
        name: 'Bad Stage',
        position: -1,
        probability: 50,
      }),
    ).rejects.toThrow()
  })

  it('updateStage updates a stage', async () => {
    const ctx = createMockCtx()
    const qb = (ctx.db as unknown as { update: ReturnType<typeof vi.fn> }).update()
    qb._result = [
      {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Qualified',
        position: 1,
        probability: 30,
      },
    ]
    const caller = createCaller(ctx)
    await expect(
      caller.pipelines.updateStage({
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Qualified',
        probability: 30,
      }),
    ).resolves.not.toThrow()
  })

  it('deleteStage deletes a stage', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.pipelines.deleteStage({ id: '00000000-0000-0000-0000-000000000002' }),
    ).resolves.not.toThrow()
  })

  it('reorderStages reorders stages', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.pipelines.reorderStages({
        pipelineId: '00000000-0000-0000-0000-000000000001',
        stageIds: ['00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002'],
      }),
    ).resolves.not.toThrow()
  })

  it('reorderStages rejects empty stageIds', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.pipelines.reorderStages({
        pipelineId: '00000000-0000-0000-0000-000000000001',
        stageIds: [],
      }),
    ).rejects.toThrow()
  })
})

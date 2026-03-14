import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PipelinesService } from '../pipelines/pipelines.service'
import { type MockDatabase, createTestContext, makePipeline, makePipelineStage } from './helpers'

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  asc: vi.fn((col: unknown) => ({ _tag: 'asc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
}))

vi.mock('@phyne/db/schema', () => ({
  pipelineStages: {
    id: 'pipelineStages.id',
    pipelineId: 'pipelineStages.pipelineId',
    position: 'pipelineStages.position',
  },
  pipelines: {
    id: 'pipelines.id',
    isDefault: 'pipelines.isDefault',
  },
}))

describe('PipelinesService', () => {
  let service: PipelinesService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new PipelinesService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------
  describe('list()', () => {
    it('returns paginated pipelines', async () => {
      mockDb._qb._result = [makePipeline()]
      const result = await service.list()
      expect(result.items).toHaveLength(1)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })

    it('detects hasMore when rows exceed limit', async () => {
      mockDb._qb._result = [
        makePipeline({ id: 'p1' }),
        makePipeline({ id: 'p2' }),
        makePipeline({ id: 'p3' }),
      ]
      const result = await service.list({ limit: 2 })
      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
    })

    it('returns empty when no pipelines', async () => {
      mockDb._qb._result = []
      const result = await service.list()
      expect(result.items).toHaveLength(0)
      expect(result.hasMore).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // getById()
  // -------------------------------------------------------------------------
  describe('getById()', () => {
    it('returns a pipeline when found', async () => {
      const pipeline = makePipeline()
      mockDb._qb._result = [pipeline]
      const result = await service.getById('pipeline-001')
      expect(result).toEqual(pipeline)
    })

    it('returns null when not found', async () => {
      mockDb._qb._result = []
      const result = await service.getById('nonexistent')
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // getStages()
  // -------------------------------------------------------------------------
  describe('getStages()', () => {
    it('returns stages for a pipeline', async () => {
      const stages = [
        makePipelineStage(),
        makePipelineStage({ id: 'stage-002', name: 'Qualification', position: 1 }),
      ]
      mockDb._qb._result = stages
      const result = await service.getStages('pipeline-001')
      expect(result).toHaveLength(2)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns empty when pipeline has no stages', async () => {
      mockDb._qb._result = []
      const result = await service.getStages('pipeline-empty')
      expect(result).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // getDefault()
  // -------------------------------------------------------------------------
  describe('getDefault()', () => {
    it('returns the default pipeline', async () => {
      const pipeline = makePipeline({ isDefault: true })
      mockDb._qb._result = [pipeline]
      const result = await service.getDefault()
      expect(result).toEqual(pipeline)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns null when no default pipeline set', async () => {
      mockDb._qb._result = []
      const result = await service.getDefault()
      expect(result).toBeNull()
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError, ValidationError } from '../errors'
import { PipelinesService } from '../pipelines/pipelines.service'
import { type MockDatabase, createTestContext, makePipeline, makePipelineStage } from './helpers'

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

vi.mock('@phyne/db/schema', () => ({
  leads: { pipelineId: 'leads.pipelineId', stageId: 'leads.stageId' },
  opportunities: { pipelineId: 'opportunities.pipelineId', stageId: 'opportunities.stageId' },
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

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('creates a pipeline and returns it', async () => {
      const created = makePipeline({ name: 'Sales' })
      mockDb._qb._result = [created]
      const result = await service.create({ name: 'Sales' })
      expect(result).toEqual(created)
      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('unsets other defaults when isDefault is true', async () => {
      const created = makePipeline({ isDefault: true, name: 'New Default' })
      mockDb._qb._result = [created]
      const result = await service.create({ isDefault: true, name: 'New Default' })
      expect(result).toEqual(created)
      // update is called to unset existing defaults, then insert for the new pipeline
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------
  describe('update()', () => {
    it('updates a pipeline', async () => {
      const updated = makePipeline({ name: 'Renamed Pipeline' })
      mockDb._qb._result = [updated]
      const result = await service.update('pipeline-001', { name: 'Renamed Pipeline' })
      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('unsets other defaults when isDefault is true', async () => {
      const updated = makePipeline({ isDefault: true, name: 'New Default' })
      mockDb._qb._result = [updated]
      const result = await service.update('pipeline-001', { isDefault: true })
      expect(result).toEqual(updated)
      // update called at least twice: once to unset defaults, once for the actual update
      expect(mockDb.update).toHaveBeenCalledTimes(2)
    })

    it('returns null for non-existent pipeline', async () => {
      mockDb._qb._result = []
      const result = await service.update('nonexistent', { name: 'Nope' })
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // delete()
  // -------------------------------------------------------------------------
  describe('delete()', () => {
    it('deletes a pipeline', async () => {
      const pipeline = makePipeline({ id: 'pipeline-del', isDefault: false })
      const deleted = { ...pipeline }
      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) {
          // getById
          return Promise.resolve([pipeline]).then(resolve)
        }
        if (callCount === 2) {
          // leads count check
          return Promise.resolve([{ count: 0 }]).then(resolve)
        }
        if (callCount === 3) {
          // opportunities count check
          return Promise.resolve([{ count: 0 }]).then(resolve)
        }
        // actual delete returning
        return Promise.resolve([deleted]).then(resolve)
      })

      const result = await service.delete('pipeline-del')
      expect(result).toEqual(deleted)
      expect(mockDb.delete).toHaveBeenCalled()
    })

    it('throws ValidationError when trying to delete default pipeline', async () => {
      const pipeline = makePipeline({ id: 'pipeline-default', isDefault: true })
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        // getById returns a default pipeline
        return Promise.resolve([pipeline]).then(resolve)
      })

      try {
        await service.delete('pipeline-default')
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError)
        expect((err as ValidationError).message).toBe('Cannot delete the default pipeline')
      }
    })

    it('throws ConflictError when pipeline has leads', async () => {
      const pipeline = makePipeline({ id: 'pipeline-leads', isDefault: false })
      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) {
          // getById
          return Promise.resolve([pipeline]).then(resolve)
        }
        // leads count check — has leads
        return Promise.resolve([{ count: 3 }]).then(resolve)
      })

      try {
        await service.delete('pipeline-leads')
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError)
        expect((err as ConflictError).message).toBe(
          'Cannot delete pipeline: it has associated leads',
        )
      }
    })

    it('throws ConflictError when pipeline has opportunities', async () => {
      const pipeline = makePipeline({ id: 'pipeline-opps', isDefault: false })
      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) {
          // getById
          return Promise.resolve([pipeline]).then(resolve)
        }
        if (callCount === 2) {
          // leads count check — no leads
          return Promise.resolve([{ count: 0 }]).then(resolve)
        }
        // opportunities count check — has opps
        return Promise.resolve([{ count: 5 }]).then(resolve)
      })

      try {
        await service.delete('pipeline-opps')
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError)
        expect((err as ConflictError).message).toBe(
          'Cannot delete pipeline: it has associated opportunities',
        )
      }
    })

    it('returns null for non-existent pipeline', async () => {
      mockDb._qb._result = []
      const result = await service.delete('nonexistent')
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // createStage()
  // -------------------------------------------------------------------------
  describe('createStage()', () => {
    it('creates a stage and returns it', async () => {
      const stage = makePipelineStage({ name: 'Discovery', position: 2 })
      mockDb._qb._result = [stage]
      const result = await service.createStage({
        name: 'Discovery',
        pipelineId: 'pipeline-001',
        position: 2,
      })
      expect(result).toEqual(stage)
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // updateStage()
  // -------------------------------------------------------------------------
  describe('updateStage()', () => {
    it('updates a stage and returns it', async () => {
      const updated = makePipelineStage({ name: 'Renamed Stage' })
      mockDb._qb._result = [updated]
      const result = await service.updateStage('stage-001', { name: 'Renamed Stage' })
      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('returns null for non-existent stage', async () => {
      mockDb._qb._result = []
      const result = await service.updateStage('nonexistent', { name: 'Nope' })
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // deleteStage()
  // -------------------------------------------------------------------------
  describe('deleteStage()', () => {
    it('deletes a stage', async () => {
      const deleted = makePipelineStage()
      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) {
          // leads count check
          return Promise.resolve([{ count: 0 }]).then(resolve)
        }
        if (callCount === 2) {
          // opportunities count check
          return Promise.resolve([{ count: 0 }]).then(resolve)
        }
        // actual delete returning
        return Promise.resolve([deleted]).then(resolve)
      })

      const result = await service.deleteStage('stage-001')
      expect(result).toEqual(deleted)
      expect(mockDb.delete).toHaveBeenCalled()
    })

    it('throws ConflictError when stage has leads', async () => {
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        // leads count check — has leads
        return Promise.resolve([{ count: 2 }]).then(resolve)
      })

      try {
        await service.deleteStage('stage-001')
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError)
        expect((err as ConflictError).message).toBe('Cannot delete stage: it has associated leads')
      }
    })

    it('throws ConflictError when stage has opportunities', async () => {
      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) {
          // leads count check — no leads
          return Promise.resolve([{ count: 0 }]).then(resolve)
        }
        // opportunities count check — has opps
        return Promise.resolve([{ count: 4 }]).then(resolve)
      })

      try {
        await service.deleteStage('stage-001')
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError)
        expect((err as ConflictError).message).toBe(
          'Cannot delete stage: it has associated opportunities',
        )
      }
    })
  })

  // -------------------------------------------------------------------------
  // reorderStages()
  // -------------------------------------------------------------------------
  describe('reorderStages()', () => {
    it('updates positions for all stages', async () => {
      mockDb._qb._result = []
      await service.reorderStages('pipeline-001', ['stage-c', 'stage-a', 'stage-b'])
      // update called once per stageId (3 times inside transaction)
      expect(mockDb.update).toHaveBeenCalledTimes(3)
    })
  })
})

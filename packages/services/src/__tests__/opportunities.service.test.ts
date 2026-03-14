import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpportunitiesService } from '../opportunities/opportunities.service'
import { type MockDatabase, createTestContext, makeConversion, makeOpportunity } from './helpers'

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

vi.mock('@phyne/db/schema', () => ({
  conversions: { id: 'conversions.id', type: 'conversions.type' },
  opportunities: {
    deletedAt: 'opportunities.deletedAt',
    id: 'opportunities.id',
    status: 'opportunities.status',
  },
  stageTransitions: { id: 'stageTransitions.id' },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpportunitiesService', () => {
  let service: OpportunitiesService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new OpportunitiesService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------
  describe('list()', () => {
    it('returns paginated opportunities with default limit', async () => {
      const items = [makeOpportunity({ id: 'opp-001' }), makeOpportunity({ id: 'opp-002' })]
      mockDb._qb._result = items

      const result = await service.list()

      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })

    it('detects hasMore when result count exceeds limit', async () => {
      const items = [
        makeOpportunity({ id: 'opp-001' }),
        makeOpportunity({ id: 'opp-002' }),
        makeOpportunity({ id: 'opp-003' }),
      ]
      mockDb._qb._result = items

      const result = await service.list({ limit: 2 })

      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
      expect(result.nextCursor).toBe('opp-002')
    })

    it('applies cursor for cursor-based pagination', async () => {
      mockDb._qb._result = [makeOpportunity({ id: 'opp-005' })]

      const result = await service.list({ cursor: 'opp-004', limit: 10 })

      expect(result.items).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns empty result when no opportunities exist', async () => {
      mockDb._qb._result = []

      const result = await service.list()

      expect(result.items).toHaveLength(0)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // getById()
  // -------------------------------------------------------------------------
  describe('getById()', () => {
    it('returns an opportunity when found', async () => {
      const opp = makeOpportunity({ id: 'opp-123' })
      mockDb._qb._result = [opp]

      const result = await service.getById('opp-123')

      expect(result).toEqual(opp)
    })

    it('returns null when not found', async () => {
      mockDb._qb._result = []

      const result = await service.getById('nonexistent')

      expect(result).toBeNull()
    })

    it('filters out soft-deleted opportunities', async () => {
      mockDb._qb._result = []

      await service.getById('opp-deleted')

      expect(mockDb._qb.where).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('creates an opportunity and records a lead_to_opportunity conversion', async () => {
      const newOpp = makeOpportunity({ id: 'opp-new' })
      mockDb._qb._result = [newOpp]

      const result = await service.create({
        contactId: 'contact-001',
        name: 'New Deal',
        pipelineId: 'pipeline-001',
        stageId: 'stage-001',
        value: '25000.00',
      })

      expect(result).toEqual(newOpp)
      expect(mockDb.transaction).toHaveBeenCalled()
      // insert called for both opportunity and conversion
      expect(mockDb.insert).toHaveBeenCalledTimes(2)
    })

    it('creates without optional fields', async () => {
      const newOpp = makeOpportunity({ contactId: null, id: 'opp-minimal', value: null })
      mockDb._qb._result = [newOpp]

      const result = await service.create({
        name: 'Minimal Deal',
        pipelineId: 'pipeline-001',
        stageId: 'stage-001',
      })

      expect(result).toEqual(newOpp)
    })
  })

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------
  describe('update()', () => {
    it('updates an opportunity and returns the updated record', async () => {
      const updated = makeOpportunity({ id: 'opp-001', value: '50000.00' })
      mockDb._qb._result = [updated]

      const result = await service.update('opp-001', { value: '50000.00' })

      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('returns null for nonexistent opportunity', async () => {
      mockDb._qb._result = []

      const result = await service.update('nonexistent', { name: 'Updated' })

      expect(result).toBeNull()
    })

    it('records opportunity_to_won conversion when status changes to won', async () => {
      const existing = makeOpportunity({
        contactId: 'contact-001',
        id: 'opp-001',
        status: 'open',
        value: '10000.00',
      })
      const won = { ...existing, status: 'won' }

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) {
          // getById returns existing opportunity
          return Promise.resolve([existing]).then(resolve)
        }
        // All subsequent calls return the won opportunity
        return Promise.resolve([won]).then(resolve)
      })

      const result = await service.update('opp-001', { status: 'won' })

      expect(result).toEqual(won)
      // Transaction used for won status
      expect(mockDb.transaction).toHaveBeenCalled()
    })

    it('does not record conversion when already won', async () => {
      const alreadyWon = makeOpportunity({ id: 'opp-001', status: 'won' })

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) {
          // getById returns already-won opportunity
          return Promise.resolve([alreadyWon]).then(resolve)
        }
        return Promise.resolve([alreadyWon]).then(resolve)
      })

      await service.update('opp-001', { status: 'won' })

      // Transaction should NOT be called since it was already won
      expect(mockDb.transaction).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // delete() — soft delete
  // -------------------------------------------------------------------------
  describe('delete()', () => {
    it('performs a soft delete by setting deletedAt', async () => {
      const deleted = makeOpportunity({ deletedAt: new Date(), id: 'opp-001' })
      mockDb._qb._result = [deleted]

      const result = await service.delete('opp-001')

      expect(result).toEqual(deleted)
      expect(mockDb.update).toHaveBeenCalled()
      const setArg = mockDb._qb.set.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(setArg?.deletedAt).toBeInstanceOf(Date)
    })

    it('returns null for nonexistent opportunity', async () => {
      mockDb._qb._result = []

      const result = await service.delete('nonexistent')

      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // moveToStage()
  // -------------------------------------------------------------------------
  describe('moveToStage()', () => {
    it('updates stageId and records a stage transition', async () => {
      const opp = makeOpportunity({ id: 'opp-001', stageId: 'stage-001' })
      const moved = { ...opp, stageId: 'stage-002' }

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([opp]).then(resolve)
        if (callCount === 2) return Promise.resolve([moved]).then(resolve)
        return Promise.resolve([{}]).then(resolve)
      })

      const result = await service.moveToStage('opp-001', 'stage-002')

      expect(result).toEqual(moved)
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })
})

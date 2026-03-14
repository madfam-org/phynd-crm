import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeadsService } from '../leads/leads.service'
import { type MockDatabase, createTestContext, makeLead } from './helpers'

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

// Feature flags: default leadScoring to false so scoring side-effects
// don't interfere with lead CRUD tests unless explicitly enabled.
vi.mock('@phyne/config/features', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}))

// We don't need the real drizzle-orm operators; the mock DB captures calls.
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

vi.mock('@phyne/db/schema', () => ({
  conversions: { id: 'conversions.id', type: 'conversions.type' },
  leads: {
    deletedAt: 'leads.deletedAt',
    id: 'leads.id',
    status: 'leads.status',
  },
  stageTransitions: { id: 'stageTransitions.id' },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LeadsService', () => {
  let service: LeadsService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new LeadsService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------
  describe('list()', () => {
    it('returns paginated leads with default limit', async () => {
      const items = [makeLead({ id: 'lead-001' }), makeLead({ id: 'lead-002' })]
      mockDb._qb._result = items

      const result = await service.list()

      expect(mockDb.select).toHaveBeenCalled()
      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })

    it('detects hasMore when rows exceed limit', async () => {
      const limit = 2
      // Service fetches limit+1 to detect overflow
      const items = [
        makeLead({ id: 'lead-001' }),
        makeLead({ id: 'lead-002' }),
        makeLead({ id: 'lead-003' }), // overflow row
      ]
      mockDb._qb._result = items

      const result = await service.list({ limit })

      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
      expect(result.nextCursor).toBe('lead-002')
    })

    it('applies cursor for pagination', async () => {
      mockDb._qb._result = [makeLead({ id: 'lead-005' })]

      const result = await service.list({ cursor: 'lead-004', limit: 10 })

      expect(result.items).toHaveLength(1)
      // select → from → where → orderBy → limit chain was called
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns empty result when no leads exist', async () => {
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
    it('returns a lead when found', async () => {
      const lead = makeLead({ id: 'lead-123' })
      mockDb._qb._result = [lead]

      const result = await service.getById('lead-123')

      expect(result).toEqual(lead)
    })

    it('returns null when lead not found', async () => {
      mockDb._qb._result = []

      const result = await service.getById('nonexistent')

      expect(result).toBeNull()
    })

    it('filters by non-deleted leads (soft delete)', async () => {
      mockDb._qb._result = []

      await service.getById('lead-deleted')

      // The where clause should have been called (which includes isNull(deletedAt))
      expect(mockDb._qb.where).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('creates a lead and records a visitor_to_lead conversion in a transaction', async () => {
      const newLead = makeLead({ id: 'lead-new' })
      mockDb._qb._result = [newLead]

      const result = await service.create({
        contactId: 'contact-001',
        pipelineId: 'pipeline-001',
        source: 'web',
        stageId: 'stage-001',
      })

      expect(result).toEqual(newLead)
      // transaction was used
      expect(mockDb.transaction).toHaveBeenCalled()
      // insert was called at least twice inside the transaction (lead + conversion)
      expect(mockDb.insert).toHaveBeenCalledTimes(2)
    })

    it('creates a lead without a contactId', async () => {
      const newLead = makeLead({ contactId: null, id: 'lead-no-contact' })
      mockDb._qb._result = [newLead]

      const result = await service.create({
        pipelineId: 'pipeline-001',
        stageId: 'stage-001',
      })

      expect(result).toEqual(newLead)
      expect(result.contactId).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------
  describe('update()', () => {
    it('updates a lead and returns the updated record', async () => {
      const updated = makeLead({ id: 'lead-001', status: 'qualified' })
      mockDb._qb._result = [updated]

      const result = await service.update('lead-001', { status: 'qualified' })

      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('returns null when updating a nonexistent lead', async () => {
      mockDb._qb._result = []

      const result = await service.update('nonexistent', { status: 'qualified' })

      expect(result).toBeNull()
    })

    it('triggers scoring on status change when feature is enabled', async () => {
      const { isFeatureEnabled } = await import('@phyne/config/features')
      ;(isFeatureEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true)

      const updated = makeLead({ id: 'lead-001', status: 'qualified' })
      mockDb._qb._result = [updated]

      // computeScore will also call db methods; just verify no error thrown
      await service.update('lead-001', { status: 'qualified' })

      expect(isFeatureEnabled).toHaveBeenCalledWith('leadScoring')
    })

    it('does not trigger scoring for non-status updates', async () => {
      const { isFeatureEnabled } = await import('@phyne/config/features')
      const spy = isFeatureEnabled as ReturnType<typeof vi.fn>
      spy.mockClear()
      spy.mockReturnValue(true)

      const updated = makeLead({ id: 'lead-001', ownerId: 'user-2' })
      mockDb._qb._result = [updated]

      await service.update('lead-001', { ownerId: 'user-2' })

      // isFeatureEnabled should NOT have been called since no status in data
      expect(spy).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // delete() — soft delete
  // -------------------------------------------------------------------------
  describe('delete()', () => {
    it('performs a soft delete by setting deletedAt', async () => {
      const deleted = makeLead({ deletedAt: new Date(), id: 'lead-001' })
      mockDb._qb._result = [deleted]

      const result = await service.delete('lead-001')

      expect(result).toEqual(deleted)
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb._qb.set).toHaveBeenCalled()
      // Verify set was called with an object containing deletedAt
      const setArg = mockDb._qb.set.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(setArg).toBeDefined()
      expect(setArg?.deletedAt).toBeInstanceOf(Date)
    })

    it('returns null when deleting a nonexistent lead', async () => {
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
      const lead = makeLead({ id: 'lead-001', stageId: 'stage-001' })
      const movedLead = { ...lead, stageId: 'stage-002' }

      // First call: getById returns existing lead
      // Subsequent calls: update returns moved lead, insert records transition
      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) {
          // getById
          return Promise.resolve([lead]).then(resolve)
        }
        if (callCount === 2) {
          // update → returning
          return Promise.resolve([movedLead]).then(resolve)
        }
        // stage transition insert
        return Promise.resolve([{}]).then(resolve)
      })

      const result = await service.moveToStage('lead-001', 'stage-002')

      expect(result).toEqual(movedLead)
      // insert was called for the stage transition
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })
})

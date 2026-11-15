import type { LeadAttribution } from '@phynd/types/crm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeadsService } from '../leads/leads.service'
import { type MockDatabase, createTestContext, makeLead } from './helpers'

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

// Feature flags: default leadScoring to false so scoring side-effects
// don't interfere with lead CRUD tests unless explicitly enabled.
vi.mock('@phynd/config/features', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}))

// We don't need the real drizzle-orm operators; the mock DB captures calls.
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

vi.mock('@phynd/db/schema', () => ({
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

    it('stores only the known attribution shape', async () => {
      mockDb._qb._result = [makeLead({ id: 'lead-attributed' })]

      await service.create({
        attribution: {
          booking: { id: 'bk-1', starts_at: '2026-11-17T16:00:00.000Z' },
          // Not part of the shape: must never reach the row.
          internal_note: 'x',
          utm_campaign: '  otono  ',
          utm_medium: 42,
          utm_source: 'newsletter',
        } as unknown as LeadAttribution,
        pipelineId: 'pipeline-001',
        source: 'kalya',
        stageId: 'stage-001',
      })

      const inserted = mockDb._qb.values.mock.calls[0]?.[0] as Record<string, unknown>
      expect(inserted.source).toBe('kalya')
      expect(inserted.attribution).toEqual({
        booking: { id: 'bk-1', starts_at: '2026-11-17T16:00:00.000Z' },
        utm_campaign: 'otono',
        utm_source: 'newsletter',
      })
    })

    it('stores null when the attribution has nothing usable', async () => {
      mockDb._qb._result = [makeLead({ id: 'lead-empty-attribution' })]

      await service.create({
        attribution: { utm_source: '   ' },
        pipelineId: 'pipeline-001',
        stageId: 'stage-001',
      })

      const inserted = mockDb._qb.values.mock.calls[0]?.[0] as Record<string, unknown>
      expect(inserted.attribution).toBeNull()
    })

    it('leaves the column untouched when no attribution is passed', async () => {
      mockDb._qb._result = [makeLead({ id: 'lead-plain' })]

      await service.create({ pipelineId: 'pipeline-001', stageId: 'stage-001' })

      const inserted = mockDb._qb.values.mock.calls[0]?.[0] as Record<string, unknown>
      expect('attribution' in inserted).toBe(false)
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
      const { isFeatureEnabled } = await import('@phynd/config/features')
      ;(isFeatureEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true)

      const updated = makeLead({ id: 'lead-001', status: 'qualified' })
      mockDb._qb._result = [updated]

      // computeScore will also call db methods; just verify no error thrown
      await service.update('lead-001', { status: 'qualified' })

      expect(isFeatureEnabled).toHaveBeenCalledWith('leadScoring')
    })

    it('scores in its own (sub)transaction and swallows a scoring failure', async () => {
      const { isFeatureEnabled } = await import('@phynd/config/features')
      ;(isFeatureEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true)
      mockDb._qb._result = [makeLead({ id: 'lead-001', status: 'qualified' })]
      mockDb.transaction.mockClear()
      mockDb.transaction.mockRejectedValueOnce(new Error('scoring query failed'))

      const result = await service.update('lead-001', { status: 'qualified' })

      expect(result).toEqual(expect.objectContaining({ id: 'lead-001' }))
      // On a caller's transaction this is a savepoint: the failure rolls back
      // the scoring only and leaves the caller's transaction usable.
      expect(mockDb.transaction).toHaveBeenCalledTimes(1)
    })

    it('does not trigger scoring for non-status updates', async () => {
      const { isFeatureEnabled } = await import('@phynd/config/features')
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

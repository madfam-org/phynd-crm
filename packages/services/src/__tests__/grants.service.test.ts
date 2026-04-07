import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GrantsService } from '../grants/grants.service'
import { type MockDatabase, createTestContext } from './helpers'

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
  sql: vi.fn(),
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
}))

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeGrantOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-opp-001',
    fortunaGrantId: 'fortuna-123',
    title: 'Test Grant',
    grantingBody: 'CONACYT',
    category: 'technology',
    fundingType: 'grant',
    minAmount: '100000.00',
    maxAmount: '500000.00',
    currency: 'MXN',
    sourceUrl: 'https://grants.example.com/123',
    closesAt: null,
    relevanceScore: '0.850',
    requirementsSummary: 'Test requirements',
    metadata: null,
    createdAt: new Date('2025-01-15T10:00:00Z'),
    updatedAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  }
}

function makeGrantApplication(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-app-001',
    grantOpportunityId: 'grant-opp-001',
    contactId: null,
    pipelineId: 'pipeline-grants',
    stageId: 'stage-discovered',
    status: 'draft',
    hitlApprovedBy: null,
    hitlApprovedAt: null,
    hitlNotes: null,
    requestedAmount: '500000.00',
    awardedAmount: null,
    applicationDraft: {},
    complianceChecks: {},
    submittedAt: null,
    ownerId: null,
    deletedAt: null,
    createdAt: new Date('2025-01-15T10:00:00Z'),
    updatedAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GrantsService', () => {
  let service: GrantsService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new GrantsService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // listOpportunities()
  // -------------------------------------------------------------------------
  describe('listOpportunities()', () => {
    it('returns paginated grant opportunities', async () => {
      const items = [
        makeGrantOpportunity({ id: 'grant-opp-001' }),
        makeGrantOpportunity({ id: 'grant-opp-002' }),
      ]
      mockDb._qb._result = items

      const result = await service.listOpportunities()

      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })

    it('detects hasMore when result count exceeds limit', async () => {
      const items = [
        makeGrantOpportunity({ id: 'grant-opp-001' }),
        makeGrantOpportunity({ id: 'grant-opp-002' }),
        makeGrantOpportunity({ id: 'grant-opp-003' }),
      ]
      mockDb._qb._result = items

      const result = await service.listOpportunities({ limit: 2 })

      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
      expect(result.nextCursor).toBe('grant-opp-002')
    })
  })

  // -------------------------------------------------------------------------
  // getOpportunity()
  // -------------------------------------------------------------------------
  describe('getOpportunity()', () => {
    it('returns an opportunity when found', async () => {
      const opp = makeGrantOpportunity({ id: 'grant-opp-123' })
      mockDb._qb._result = [opp]

      const result = await service.getOpportunity('grant-opp-123')

      expect(result).toEqual(opp)
    })

    it('throws NotFoundError when not found', async () => {
      mockDb._qb._result = []

      await expect(service.getOpportunity('nonexistent')).rejects.toThrow('not found')
    })
  })

  // -------------------------------------------------------------------------
  // upsertOpportunity()
  // -------------------------------------------------------------------------
  describe('upsertOpportunity()', () => {
    it('creates a new opportunity when no existing one found', async () => {
      const newOpp = makeGrantOpportunity({ id: 'grant-opp-new' })

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([]).then(resolve) // select returns empty
        return Promise.resolve([newOpp]).then(resolve) // insert returns new
      })

      const result = await service.upsertOpportunity({
        fortunaGrantId: 'fortuna-new',
        title: 'New Grant',
      })

      expect(result).toEqual(newOpp)
      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('updates existing opportunity when found', async () => {
      const existing = makeGrantOpportunity({ id: 'grant-opp-existing' })
      const updated = { ...existing, title: 'Updated Title' }

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([existing]).then(resolve) // select returns existing
        return Promise.resolve([updated]).then(resolve) // update returns updated
      })

      const result = await service.upsertOpportunity({
        fortunaGrantId: 'fortuna-123',
        title: 'Updated Title',
      })

      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // listApplications()
  // -------------------------------------------------------------------------
  describe('listApplications()', () => {
    it('returns paginated applications', async () => {
      const items = [makeGrantApplication({ id: 'grant-app-001' })]
      mockDb._qb._result = items

      const result = await service.listApplications()

      expect(result.items).toHaveLength(1)
      expect(result.hasMore).toBe(false)
    })

    it('filters by status', async () => {
      mockDb._qb._result = []

      await service.listApplications(undefined, { status: 'hitl_pending' })

      expect(mockDb._qb.where).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // getApplication()
  // -------------------------------------------------------------------------
  describe('getApplication()', () => {
    it('returns an application when found', async () => {
      const app = makeGrantApplication({ id: 'grant-app-123' })
      mockDb._qb._result = [app]

      const result = await service.getApplication('grant-app-123')

      expect(result).toEqual(app)
    })

    it('throws NotFoundError when not found', async () => {
      mockDb._qb._result = []

      await expect(service.getApplication('nonexistent')).rejects.toThrow('not found')
    })
  })

  // -------------------------------------------------------------------------
  // createApplication()
  // -------------------------------------------------------------------------
  describe('createApplication()', () => {
    it('creates an application and records audit event', async () => {
      const newApp = makeGrantApplication({ id: 'grant-app-new' })
      mockDb._qb._result = [newApp]

      const result = await service.createApplication({
        grantOpportunityId: 'grant-opp-001',
        pipelineId: 'pipeline-grants',
        stageId: 'stage-discovered',
      })

      expect(result).toEqual(newApp)
      // insert called for both application and audit
      expect(mockDb.insert).toHaveBeenCalledTimes(2)
    })
  })

  // -------------------------------------------------------------------------
  // HITL gate enforcement
  // -------------------------------------------------------------------------
  describe('approveForSubmission()', () => {
    it('rejects approval without a real userId', async () => {
      await expect(service.approveForSubmission('grant-app-001', '', 'notes')).rejects.toThrow(
        'real userId',
      )
    })

    it('rejects approval when RFC is not active', async () => {
      const app = makeGrantApplication({
        complianceChecks: { rfc_active: false, opinion_32d_positive: true, blacklisted: false },
      })
      mockDb._qb._result = [app]

      await expect(service.approveForSubmission('grant-app-001', 'user-1')).rejects.toThrow(
        'RFC is not active',
      )
    })

    it('rejects approval when 32-D opinion is not positive', async () => {
      const app = makeGrantApplication({
        complianceChecks: { rfc_active: true, opinion_32d_positive: false, blacklisted: false },
      })
      mockDb._qb._result = [app]

      await expect(service.approveForSubmission('grant-app-001', 'user-1')).rejects.toThrow(
        '32-D opinion',
      )
    })

    it('rejects approval when entity is blacklisted', async () => {
      const app = makeGrantApplication({
        complianceChecks: { rfc_active: true, opinion_32d_positive: true, blacklisted: true },
      })
      mockDb._qb._result = [app]

      await expect(service.approveForSubmission('grant-app-001', 'user-1')).rejects.toThrow(
        'blacklisted',
      )
    })

    it('approves when all compliance checks pass', async () => {
      const app = makeGrantApplication({
        complianceChecks: { rfc_active: true, opinion_32d_positive: true, blacklisted: false },
      })
      const approved = { ...app, status: 'approved_to_submit', hitlApprovedBy: 'user-1' }

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([app]).then(resolve) // getApplication
        if (callCount === 2) return Promise.resolve([approved]).then(resolve) // update
        return Promise.resolve([{}]).then(resolve) // audit
      })

      const result = await service.approveForSubmission('grant-app-001', 'user-1', 'Looks good')

      expect(result).toEqual(approved)
      expect(mockDb.update).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Stage transitions
  // -------------------------------------------------------------------------
  describe('moveToStage()', () => {
    it('updates stage and records audit event', async () => {
      const app = makeGrantApplication({ id: 'grant-app-001', stageId: 'stage-discovered' })
      const moved = { ...app, stageId: 'stage-evaluating' }

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([app]).then(resolve)
        if (callCount === 2) return Promise.resolve([moved]).then(resolve)
        return Promise.resolve([{}]).then(resolve)
      })

      const result = await service.moveToStage('grant-app-001', 'stage-evaluating')

      expect(result).toEqual(moved)
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // requestHitlApproval()
  // -------------------------------------------------------------------------
  describe('requestHitlApproval()', () => {
    it('sets status to hitl_pending and records audit', async () => {
      const app = makeGrantApplication({ id: 'grant-app-001' })
      const pending = { ...app, status: 'hitl_pending' }

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([app]).then(resolve)
        if (callCount === 2) return Promise.resolve([pending]).then(resolve)
        return Promise.resolve([{}]).then(resolve)
      })

      const result = await service.requestHitlApproval('grant-app-001')

      expect(result).toEqual(pending)
    })
  })

  // -------------------------------------------------------------------------
  // markSubmitted()
  // -------------------------------------------------------------------------
  describe('markSubmitted()', () => {
    it('sets status to submitted and records submittedAt', async () => {
      const app = makeGrantApplication({ id: 'grant-app-001', status: 'approved_to_submit' })
      const submitted = { ...app, status: 'submitted', submittedAt: new Date() }

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([app]).then(resolve)
        if (callCount === 2) return Promise.resolve([submitted]).then(resolve)
        return Promise.resolve([{}]).then(resolve)
      })

      const result = await service.markSubmitted('grant-app-001')

      expect(result?.status).toBe('submitted')
    })
  })

  // -------------------------------------------------------------------------
  // markAwarded()
  // -------------------------------------------------------------------------
  describe('markAwarded()', () => {
    it('sets status to awarded and records awardedAmount', async () => {
      const app = makeGrantApplication({ id: 'grant-app-001', status: 'submitted' })
      const awarded = { ...app, status: 'awarded', awardedAmount: '400000.00' }

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([app]).then(resolve)
        if (callCount === 2) return Promise.resolve([awarded]).then(resolve)
        return Promise.resolve([{}]).then(resolve)
      })

      const result = await service.markAwarded('grant-app-001', '400000.00')

      expect(result?.status).toBe('awarded')
      expect(result?.awardedAmount).toBe('400000.00')
    })
  })

  // -------------------------------------------------------------------------
  // getAuditTrail()
  // -------------------------------------------------------------------------
  describe('getAuditTrail()', () => {
    it('returns audit events for an opportunity', async () => {
      const events = [
        { id: 'audit-1', eventType: 'discovered', actor: 'system' },
        { id: 'audit-2', eventType: 'hitl_requested', actor: 'user-1' },
      ]
      mockDb._qb._result = events

      const result = await service.getAuditTrail('grant-opp-001')

      expect(result).toHaveLength(2)
    })
  })

  // -------------------------------------------------------------------------
  // getPipelineStats()
  // -------------------------------------------------------------------------
  describe('getPipelineStats()', () => {
    it('returns aggregate counts by status', async () => {
      const stats = [
        { status: 'draft', count: 5 },
        { status: 'hitl_pending', count: 2 },
        { status: 'awarded', count: 1 },
      ]
      mockDb._qb._result = stats

      const result = await service.getPipelineStats()

      expect(result).toHaveLength(3)
    })
  })

  // -------------------------------------------------------------------------
  // updateComplianceChecks()
  // -------------------------------------------------------------------------
  describe('updateComplianceChecks()', () => {
    it('updates compliance checks and records audit', async () => {
      const app = makeGrantApplication({ id: 'grant-app-001' })
      const updated = {
        ...app,
        complianceChecks: { rfc_active: true, opinion_32d_positive: true, blacklisted: false },
      }

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([app]).then(resolve)
        if (callCount === 2) return Promise.resolve([updated]).then(resolve)
        return Promise.resolve([{}]).then(resolve)
      })

      const result = await service.updateComplianceChecks('grant-app-001', {
        rfc_active: true,
        opinion_32d_positive: true,
        blacklisted: false,
      })

      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // rejectSubmission()
  // -------------------------------------------------------------------------
  describe('rejectSubmission()', () => {
    it('sets status to rejected and records audit', async () => {
      const app = makeGrantApplication({ id: 'grant-app-001', status: 'hitl_pending' })
      const rejected = { ...app, status: 'rejected' }

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([app]).then(resolve)
        if (callCount === 2) return Promise.resolve([rejected]).then(resolve)
        return Promise.resolve([{}]).then(resolve)
      })

      const result = await service.rejectSubmission('grant-app-001', 'user-1', 'Not eligible')

      expect(result?.status).toBe('rejected')
    })
  })
})

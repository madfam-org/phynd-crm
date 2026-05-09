import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeadScoringService } from '../lead-scoring/lead-scoring.service'
import { type MockDatabase, createTestContext, makeLead, makeScoringRule } from './helpers'

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      _tag: 'sql',
      strings,
      values,
    })),
    {
      join: vi.fn(),
    },
  ),
}))

vi.mock('@phynd/db/schema', () => ({
  leadScores: {
    breakdown: 'leadScores.breakdown',
    id: 'leadScores.id',
    leadId: 'leadScores.leadId',
  },
  leadScoringRules: {
    id: 'leadScoringRules.id',
    isActive: 'leadScoringRules.isActive',
  },
  leads: {
    id: 'leads.id',
    status: 'leads.status',
  },
  visitorPageViews: {
    sessionId: 'visitorPageViews.sessionId',
    url: 'visitorPageViews.url',
  },
  visitorSessions: {
    contactId: 'visitorSessions.contactId',
    id: 'visitorSessions.id',
    pageViewCount: 'visitorSessions.pageViewCount',
  },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LeadScoringService — CRUD & Batch', () => {
  let service: LeadScoringService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new LeadScoringService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // batchCompute()
  // -------------------------------------------------------------------------
  describe('batchCompute()', () => {
    it('processes multiple leads and returns results for existing ones', async () => {
      const lead1 = makeLead({ contactId: null, id: 'lead-001', source: 'web' })
      const lead2 = makeLead({ contactId: null, id: 'lead-002', source: 'direct' })
      const rule = makeScoringRule({
        condition: { field: 'source', operator: 'eq', value: 'web' },
        id: 'rule-1',
        points: 10,
      })

      const responses: unknown[][] = [
        [lead1],
        [rule],
        [],
        [
          {
            behaviorScore: 0,
            breakdown: { 'rule-1': 10 },
            demographicScore: 10,
            engagementScore: 0,
            id: 'score-001',
            leadId: 'lead-001',
            totalScore: 10,
          },
        ],
        [lead2],
        [rule],
        [],
        [
          {
            behaviorScore: 0,
            breakdown: {},
            demographicScore: 0,
            engagementScore: 0,
            id: 'score-002',
            leadId: 'lead-002',
            totalScore: 0,
          },
        ],
      ]
      let globalCallCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        globalCallCount++
        const result = responses[globalCallCount - 1] ?? []
        return Promise.resolve(result).then(resolve)
      })

      const results = await service.batchCompute(['lead-001', 'lead-002'])

      expect(results).toHaveLength(2)
    })

    it('skips leads that do not exist', async () => {
      const lead2 = makeLead({ contactId: null, id: 'lead-002', source: 'web' })
      const rule = makeScoringRule({
        condition: { field: 'source', operator: 'eq', value: 'web' },
        id: 'rule-1',
        points: 5,
      })

      const responses: unknown[][] = [
        [],
        [lead2],
        [rule],
        [],
        [
          {
            behaviorScore: 0,
            breakdown: { 'rule-1': 5 },
            demographicScore: 5,
            engagementScore: 0,
            id: 'score-002',
            leadId: 'lead-002',
            totalScore: 5,
          },
        ],
      ]
      let globalCallCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        globalCallCount++
        const result = responses[globalCallCount - 1] ?? []
        return Promise.resolve(result).then(resolve)
      })

      const results = await service.batchCompute(['nonexistent', 'lead-002'])

      expect(results).toHaveLength(1)
      expect(results[0]?.leadId).toBe('lead-002')
    })
  })

  // -------------------------------------------------------------------------
  // listRules()
  // -------------------------------------------------------------------------
  describe('listRules()', () => {
    it('returns paginated rules', async () => {
      const rules = [makeScoringRule({ id: 'rule-1' }), makeScoringRule({ id: 'rule-2' })]
      mockDb._qb._result = rules

      const result = await service.listRules()

      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(false)
    })

    it('handles cursor-based pagination', async () => {
      const rules = [
        makeScoringRule({ id: 'rule-3' }),
        makeScoringRule({ id: 'rule-4' }),
        makeScoringRule({ id: 'rule-5' }),
      ]
      mockDb._qb._result = rules

      const result = await service.listRules({ cursor: 'rule-2', limit: 2 })

      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // createRule()
  // -------------------------------------------------------------------------
  describe('createRule()', () => {
    it('creates a scoring rule', async () => {
      const rule = makeScoringRule({ id: 'rule-new' })
      mockDb._qb._result = [rule]

      const result = await service.createRule({
        category: 'demographic',
        condition: { field: 'source', operator: 'eq', value: 'web' },
        name: 'Web source bonus',
        points: 10,
      })

      expect(result).toEqual(rule)
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // getScore()
  // -------------------------------------------------------------------------
  describe('getScore()', () => {
    it('returns score when it exists', async () => {
      const score = {
        behaviorScore: 5,
        breakdown: { 'rule-1': 10 },
        demographicScore: 10,
        engagementScore: 0,
        id: 'score-001',
        leadId: 'lead-001',
        totalScore: 15,
      }
      mockDb._qb._result = [score]

      const result = await service.getScore('lead-001')

      expect(result).toEqual(score)
    })

    it('returns null when no score exists', async () => {
      mockDb._qb._result = []

      const result = await service.getScore('lead-no-score')

      expect(result).toBeNull()
    })
  })
})

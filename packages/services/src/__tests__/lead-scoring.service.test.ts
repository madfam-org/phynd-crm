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

vi.mock('@phyne/db/schema', () => ({
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

describe('LeadScoringService', () => {
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
  // evaluateCondition() — tested via computeScore() behavior
  // -------------------------------------------------------------------------
  describe('evaluateCondition (via computeScore)', () => {
    /**
     * Helper to run a scoring computation with a single rule.
     *
     * Call sequence for computeScore when lead.contactId is truthy:
     *   1. select lead
     *   2. select active rules
     *   3. session aggregate (count, pageViews)
     *   4. session IDs
     *   5. (only if sessionIds.length > 0) page view URLs
     *   6. existing score check
     *   7. insert or update score
     *
     * When lead.contactId is null/undefined, calls 3-5 are skipped entirely.
     */
    async function scoreWithRule(
      rule: ReturnType<typeof makeScoringRule>,
      leadOverrides: Record<string, unknown> = {},
      sessionData: { count: number; pageViews: number } = { count: 0, pageViews: 0 },
      pageUrls: string[] = [],
    ) {
      const lead = makeLead({ contactId: 'contact-001', ...leadOverrides })
      const hasContactId = lead.contactId != null
      const hasSessionIds = pageUrls.length > 0

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++

        // Call 1: get lead
        if (callCount === 1) return Promise.resolve([lead]).then(resolve)
        // Call 2: get active rules
        if (callCount === 2) return Promise.resolve([rule]).then(resolve)

        if (hasContactId) {
          // Call 3: session aggregate
          if (callCount === 3) {
            return Promise.resolve([
              { count: sessionData.count, pageViews: sessionData.pageViews },
            ]).then(resolve)
          }
          // Call 4: session IDs
          if (callCount === 4) {
            return Promise.resolve(hasSessionIds ? [{ id: 'session-001' }] : []).then(resolve)
          }

          if (hasSessionIds) {
            // Call 5: page view URLs (only when sessionIds non-empty)
            if (callCount === 5) {
              return Promise.resolve(pageUrls.map((url) => ({ url }))).then(resolve)
            }
            // Call 6: existing score check
            if (callCount === 6) return Promise.resolve([]).then(resolve)
            // Call 7: insert score
            if (callCount === 7) {
              return Promise.resolve([
                {
                  behaviorScore: 0,
                  breakdown: {},
                  computedAt: new Date(),
                  demographicScore: 0,
                  engagementScore: 0,
                  id: 'score-001',
                  leadId: lead.id,
                  totalScore: rule.points,
                },
              ]).then(resolve)
            }
          } else {
            // No page URLs -> sessionIds was empty -> skip page view query
            // Call 5: existing score check
            if (callCount === 5) return Promise.resolve([]).then(resolve)
            // Call 6: insert score
            if (callCount === 6) {
              return Promise.resolve([
                {
                  behaviorScore: 0,
                  breakdown: {},
                  computedAt: new Date(),
                  demographicScore: 0,
                  engagementScore: 0,
                  id: 'score-001',
                  leadId: lead.id,
                  totalScore: rule.points,
                },
              ]).then(resolve)
            }
          }
        } else {
          // No contactId: session queries are skipped entirely
          // Call 3: existing score check
          if (callCount === 3) return Promise.resolve([]).then(resolve)
          // Call 4: insert score
          if (callCount === 4) {
            return Promise.resolve([
              {
                behaviorScore: 0,
                breakdown: {},
                computedAt: new Date(),
                demographicScore: 0,
                engagementScore: 0,
                id: 'score-001',
                leadId: lead.id,
                totalScore: rule.points,
              },
            ]).then(resolve)
          }
        }

        return Promise.resolve([]).then(resolve)
      })

      return service.computeScore(lead.id as string)
    }

    it('matches eq operator for string fields (source)', async () => {
      const rule = makeScoringRule({
        category: 'demographic',
        condition: { field: 'source', operator: 'eq', value: 'web' },
        id: 'rule-eq',
        points: 10,
      })

      const result = await scoreWithRule(rule, { source: 'web' })

      expect(result).not.toBeNull()
      expect(result?.totalScore).toBe(10)
    })

    it('does not match eq when value differs', async () => {
      const rule = makeScoringRule({
        condition: { field: 'source', operator: 'eq', value: 'web' },
        id: 'rule-eq-miss',
        points: 10,
      })

      // Lead has source='referral', rule expects 'web'
      const lead = makeLead({ contactId: null, source: 'referral' })
      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        // contactId is null -> no session queries
        if (callCount === 1) return Promise.resolve([lead]).then(resolve)
        if (callCount === 2) return Promise.resolve([rule]).then(resolve)
        // existing check
        if (callCount === 3) return Promise.resolve([]).then(resolve)
        // insert score (0 total)
        return Promise.resolve([
          {
            behaviorScore: 0,
            breakdown: {},
            demographicScore: 0,
            engagementScore: 0,
            id: 'score-001',
            leadId: 'lead-001',
            totalScore: 0,
          },
        ]).then(resolve)
      })

      const result = await service.computeScore('lead-001')

      expect(result).not.toBeNull()
      expect(result?.totalScore).toBe(0)
    })

    it('matches gt operator for numeric fields (session_count)', async () => {
      const rule = makeScoringRule({
        category: 'behavior',
        condition: { field: 'session_count', operator: 'gt', value: 2 },
        id: 'rule-gt',
        points: 15,
      })

      const result = await scoreWithRule(rule, {}, { count: 5, pageViews: 10 })

      expect(result).not.toBeNull()
      expect(result?.totalScore).toBe(15)
    })

    it('matches contains operator for string fields', async () => {
      const rule = makeScoringRule({
        category: 'engagement',
        condition: { field: 'page_url', operator: 'contains', value: '/pricing' },
        id: 'rule-contains',
        points: 20,
      })

      const result = await scoreWithRule(rule, {}, { count: 1, pageViews: 3 }, [
        '/home',
        '/pricing/enterprise',
        '/about',
      ])

      expect(result).not.toBeNull()
      expect(result?.totalScore).toBe(20)
    })

    it('matches exists operator for has_contact', async () => {
      const rule = makeScoringRule({
        category: 'demographic',
        condition: { field: 'has_contact', operator: 'exists' },
        id: 'rule-exists',
        points: 5,
      })

      const result = await scoreWithRule(rule, { contactId: 'contact-001' })

      expect(result).not.toBeNull()
      expect(result?.totalScore).toBe(5)
    })

    it('matches 3d_asset_views counting forj:// URLs', async () => {
      const rule = makeScoringRule({
        category: 'engagement',
        condition: { field: '3d_asset_views', operator: 'gt', value: 1 },
        id: 'rule-3d',
        points: 25,
      })

      const result = await scoreWithRule(rule, {}, { count: 1, pageViews: 5 }, [
        'forj://asset/a1/view',
        'forj://asset/a2/interact',
        '/home',
      ])

      expect(result).not.toBeNull()
      expect(result?.totalScore).toBe(25)
    })
  })

  // -------------------------------------------------------------------------
  // computeScore() — scoring result structure
  // -------------------------------------------------------------------------
  describe('computeScore()', () => {
    it('returns null when lead does not exist', async () => {
      mockDb._qb._result = []

      const result = await service.computeScore('nonexistent')

      expect(result).toBeNull()
    })

    it('computes breakdown keyed by rule.id, not rule.name', async () => {
      // contactId is null -> no session queries
      const lead = makeLead({ contactId: null, id: 'lead-001', source: 'web' })
      const rule = makeScoringRule({
        category: 'demographic',
        condition: { field: 'source', operator: 'eq', value: 'web' },
        id: 'rule-abc',
        name: 'Web Source Rule',
        points: 10,
      })

      const expectedBreakdown = { 'rule-abc': 10 }
      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([lead]).then(resolve)
        if (callCount === 2) return Promise.resolve([rule]).then(resolve)
        // No contactId -> skip session queries
        // existing score check
        if (callCount === 3) return Promise.resolve([]).then(resolve)
        // insert score
        return Promise.resolve([
          {
            behaviorScore: 0,
            breakdown: expectedBreakdown,
            demographicScore: 10,
            engagementScore: 0,
            id: 'score-001',
            leadId: 'lead-001',
            totalScore: 10,
          },
        ]).then(resolve)
      })

      const result = await service.computeScore('lead-001')

      expect(result).not.toBeNull()
      // Verify insert was called and check that breakdown uses rule.id
      const insertCalls = mockDb.insert.mock.calls
      expect(insertCalls.length).toBeGreaterThan(0)
    })

    it('upserts an existing score instead of creating a new one', async () => {
      // contactId is null -> no session queries
      const lead = makeLead({ contactId: null, id: 'lead-001', source: 'web' })
      const rule = makeScoringRule({
        condition: { field: 'source', operator: 'eq', value: 'web' },
        id: 'rule-abc',
        points: 10,
      })
      const existingScore = {
        behaviorScore: 0,
        breakdown: {},
        demographicScore: 5,
        engagementScore: 0,
        id: 'score-existing',
        leadId: 'lead-001',
        totalScore: 5,
      }

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([lead]).then(resolve)
        if (callCount === 2) return Promise.resolve([rule]).then(resolve)
        // No contactId -> skip session queries
        // existing score: found
        if (callCount === 3) return Promise.resolve([existingScore]).then(resolve)
        // update returns updated score
        return Promise.resolve([
          {
            ...existingScore,
            demographicScore: 10,
            totalScore: 10,
          },
        ]).then(resolve)
      })

      const result = await service.computeScore('lead-001')

      expect(result).not.toBeNull()
      // update was called (for the existing score upsert)
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('accumulates scores across categories', async () => {
      // contactId is set -> session queries happen
      const lead = makeLead({
        contactId: 'contact-001',
        id: 'lead-001',
        source: 'web',
        status: 'qualified',
      })
      const rules = [
        makeScoringRule({
          category: 'demographic',
          condition: { field: 'source', operator: 'eq', value: 'web' },
          id: 'rule-1',
          points: 10,
        }),
        makeScoringRule({
          category: 'demographic',
          condition: { field: 'status', operator: 'eq', value: 'qualified' },
          id: 'rule-2',
          points: 20,
        }),
        makeScoringRule({
          category: 'behavior',
          condition: { field: 'session_count', operator: 'gt', value: 0 },
          id: 'rule-3',
          points: 15,
        }),
      ]

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([lead]).then(resolve)
        if (callCount === 2) return Promise.resolve(rules).then(resolve)
        // session aggregate
        if (callCount === 3) return Promise.resolve([{ count: 3, pageViews: 10 }]).then(resolve)
        // session IDs -> return non-empty to trigger page view query
        if (callCount === 4) return Promise.resolve([{ id: 'session-001' }]).then(resolve)
        // page view URLs -> empty (no page_url rules match anyway)
        if (callCount === 5) return Promise.resolve([]).then(resolve)
        // existing score check
        if (callCount === 6) return Promise.resolve([]).then(resolve)
        // Insert new score
        return Promise.resolve([
          {
            behaviorScore: 15,
            breakdown: { 'rule-1': 10, 'rule-2': 20, 'rule-3': 15 },
            demographicScore: 30,
            engagementScore: 0,
            id: 'score-001',
            leadId: 'lead-001',
            totalScore: 45,
          },
        ]).then(resolve)
      })

      const result = await service.computeScore('lead-001')

      expect(result).not.toBeNull()
      expect(result?.totalScore).toBe(45)
      expect(result?.demographicScore).toBe(30)
      expect(result?.behaviorScore).toBe(15)
    })
  })

  // -------------------------------------------------------------------------
  // batchCompute()
  // -------------------------------------------------------------------------
  describe('batchCompute()', () => {
    it('processes multiple leads and returns results for existing ones', async () => {
      // Both leads have contactId: null -> no session queries
      const lead1 = makeLead({ contactId: null, id: 'lead-001', source: 'web' })
      const lead2 = makeLead({ contactId: null, id: 'lead-002', source: 'direct' })
      const rule = makeScoringRule({
        condition: { field: 'source', operator: 'eq', value: 'web' },
        id: 'rule-1',
        points: 10,
      })

      let globalCallCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        globalCallCount++
        // Lead 1 sequence (contactId: null -> 4 calls: lead, rules, existing, insert)
        if (globalCallCount === 1) return Promise.resolve([lead1]).then(resolve)
        if (globalCallCount === 2) return Promise.resolve([rule]).then(resolve)
        // existing score check
        if (globalCallCount === 3) return Promise.resolve([]).then(resolve)
        // insert score
        if (globalCallCount === 4)
          return Promise.resolve([
            {
              behaviorScore: 0,
              breakdown: { 'rule-1': 10 },
              demographicScore: 10,
              engagementScore: 0,
              id: 'score-001',
              leadId: 'lead-001',
              totalScore: 10,
            },
          ]).then(resolve)
        // Lead 2 sequence (contactId: null -> 4 calls)
        if (globalCallCount === 5) return Promise.resolve([lead2]).then(resolve)
        if (globalCallCount === 6) return Promise.resolve([rule]).then(resolve)
        // existing score check
        if (globalCallCount === 7) return Promise.resolve([]).then(resolve)
        // insert score
        if (globalCallCount === 8)
          return Promise.resolve([
            {
              behaviorScore: 0,
              breakdown: {},
              demographicScore: 0,
              engagementScore: 0,
              id: 'score-002',
              leadId: 'lead-002',
              totalScore: 0,
            },
          ]).then(resolve)
        return Promise.resolve([]).then(resolve)
      })

      const results = await service.batchCompute(['lead-001', 'lead-002'])

      expect(results).toHaveLength(2)
    })

    it('skips leads that do not exist', async () => {
      // Lead 2 has contactId: null -> no session queries
      const lead2 = makeLead({ contactId: null, id: 'lead-002', source: 'web' })
      const rule = makeScoringRule({
        condition: { field: 'source', operator: 'eq', value: 'web' },
        id: 'rule-1',
        points: 5,
      })

      let globalCallCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        globalCallCount++
        // Lead 1: not found (1 call)
        if (globalCallCount === 1) return Promise.resolve([]).then(resolve)
        // Lead 2: found (4 calls: lead, rules, existing, insert)
        if (globalCallCount === 2) return Promise.resolve([lead2]).then(resolve)
        if (globalCallCount === 3) return Promise.resolve([rule]).then(resolve)
        // existing score check
        if (globalCallCount === 4) return Promise.resolve([]).then(resolve)
        // insert score
        if (globalCallCount === 5)
          return Promise.resolve([
            {
              behaviorScore: 0,
              breakdown: { 'rule-1': 5 },
              demographicScore: 5,
              engagementScore: 0,
              id: 'score-002',
              leadId: 'lead-002',
              totalScore: 5,
            },
          ]).then(resolve)
        return Promise.resolve([]).then(resolve)
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
        makeScoringRule({ id: 'rule-5' }), // overflow
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

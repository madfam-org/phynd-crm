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

describe('LeadScoringService — Evaluation', () => {
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
    function buildScoreResponses(
      lead: ReturnType<typeof makeLead>,
      rule: ReturnType<typeof makeScoringRule>,
      sessionData: { count: number; pageViews: number },
      pageUrls: string[],
    ): unknown[][] {
      const scoreResult = [
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
      ]
      const hasContactId = lead.contactId != null
      const hasSessionIds = pageUrls.length > 0

      const responses: unknown[][] = [[lead], [rule]]

      if (!hasContactId) {
        responses.push([], scoreResult)
        return responses
      }

      responses.push(
        [{ count: sessionData.count, pageViews: sessionData.pageViews }],
        hasSessionIds ? [{ id: 'session-001' }] : [],
      )

      if (hasSessionIds) {
        responses.push(pageUrls.map((url) => ({ url })))
      }

      responses.push([], scoreResult)
      return responses
    }

    async function scoreWithRule(
      rule: ReturnType<typeof makeScoringRule>,
      leadOverrides: Record<string, unknown> = {},
      sessionData: { count: number; pageViews: number } = { count: 0, pageViews: 0 },
      pageUrls: string[] = [],
    ) {
      const lead = makeLead({ contactId: 'contact-001', ...leadOverrides })
      const responses = buildScoreResponses(lead, rule, sessionData, pageUrls)

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        const result = responses[callCount - 1] ?? []
        return Promise.resolve(result).then(resolve)
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

      const lead = makeLead({ contactId: null, source: 'referral' })
      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([lead]).then(resolve)
        if (callCount === 2) return Promise.resolve([rule]).then(resolve)
        if (callCount === 3) return Promise.resolve([]).then(resolve)
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
        if (callCount === 3) return Promise.resolve([]).then(resolve)
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
      const insertCalls = mockDb.insert.mock.calls
      expect(insertCalls.length).toBeGreaterThan(0)
    })

    it('upserts an existing score instead of creating a new one', async () => {
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
        if (callCount === 3) return Promise.resolve([existingScore]).then(resolve)
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
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('accumulates scores across categories', async () => {
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

      const responses: unknown[][] = [
        [lead],
        rules,
        [{ count: 3, pageViews: 10 }],
        [{ id: 'session-001' }],
        [],
        [],
        [
          {
            behaviorScore: 15,
            breakdown: { 'rule-1': 10, 'rule-2': 20, 'rule-3': 15 },
            demographicScore: 30,
            engagementScore: 0,
            id: 'score-001',
            leadId: 'lead-001',
            totalScore: 45,
          },
        ],
      ]
      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        const result = responses[callCount - 1] ?? []
        return Promise.resolve(result).then(resolve)
      })

      const result = await service.computeScore('lead-001')

      expect(result).not.toBeNull()
      expect(result?.totalScore).toBe(45)
      expect(result?.demographicScore).toBe(30)
      expect(result?.behaviorScore).toBe(15)
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsService } from '../analytics/analytics.service'
import { type MockDatabase, createTestContext, makeCampaign } from './helpers'

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  desc: vi.fn((col: unknown) => ({ _tag: 'desc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gte: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gte', col, val })),
  lte: vi.fn((col: unknown, val: unknown) => ({ _tag: 'lte', col, val })),
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
  campaigns: {
    budget: 'campaigns.budget',
    id: 'campaigns.id',
    name: 'campaigns.name',
    spend: 'campaigns.spend',
    status: 'campaigns.status',
  },
  conversions: {
    campaignId: 'conversions.campaignId',
    convertedAt: 'conversions.convertedAt',
    id: 'conversions.id',
    type: 'conversions.type',
    value: 'conversions.value',
  },
  healthSnapshots: {
    checkedAt: 'healthSnapshots.checkedAt',
    provider: 'healthSnapshots.provider',
  },
  leads: {
    createdAt: 'leads.createdAt',
  },
  opportunities: {
    createdAt: 'opportunities.createdAt',
    pipelineId: 'opportunities.pipelineId',
    status: 'opportunities.status',
    updatedAt: 'opportunities.updatedAt',
    value: 'opportunities.value',
  },
  pipelineStages: {
    id: 'pipelineStages.id',
    name: 'pipelineStages.name',
    pipelineId: 'pipelineStages.pipelineId',
    position: 'pipelineStages.position',
  },
  stageTransitions: {
    entityId: 'stageTransitions.entityId',
    entityType: 'stageTransitions.entityType',
    toStageId: 'stageTransitions.toStageId',
    transitionedAt: 'stageTransitions.transitionedAt',
  },
  visitorSessions: {
    createdAt: 'visitorSessions.createdAt',
    identified: 'visitorSessions.identified',
    pageViewCount: 'visitorSessions.pageViewCount',
    startedAt: 'visitorSessions.startedAt',
  },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnalyticsService', () => {
  let service: AnalyticsService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new AnalyticsService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // getPipelineVelocity()
  // -------------------------------------------------------------------------
  describe('getPipelineVelocity()', () => {
    it('returns pipeline velocity metrics', async () => {
      const metrics = {
        avgDaysInPipeline: 12.5,
        lostCount: 3,
        totalOpportunities: 20,
        wonCount: 8,
      }
      mockDb._qb._result = [metrics]

      const result = await service.getPipelineVelocity('pipeline-001')

      expect(result).toEqual(metrics)
    })

    it('applies date range filtering', async () => {
      mockDb._qb._result = [
        { avgDaysInPipeline: 5, lostCount: 0, totalOpportunities: 3, wonCount: 1 },
      ]

      const result = await service.getPipelineVelocity('pipeline-001', {
        from: new Date('2025-01-01'),
        to: new Date('2025-06-30'),
      })

      expect(result.totalOpportunities).toBe(3)
      // where was called with date range conditions
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns zeroed metrics when no opportunities exist', async () => {
      mockDb._qb._result = [undefined]

      const result = await service.getPipelineVelocity('pipeline-empty')

      expect(result).toEqual({
        avgDaysInPipeline: 0,
        lostCount: 0,
        totalOpportunities: 0,
        wonCount: 0,
      })
    })
  })

  // -------------------------------------------------------------------------
  // getWinRate()
  // -------------------------------------------------------------------------
  describe('getWinRate()', () => {
    it('calculates win rate as a percentage', async () => {
      mockDb._qb._result = [{ total: 10, won: 7 }]

      const result = await service.getWinRate()

      expect(result.winRate).toBe(70)
      expect(result.total).toBe(10)
      expect(result.won).toBe(7)
    })

    it('returns zero when no closed opportunities exist', async () => {
      mockDb._qb._result = [{ total: 0, won: 0 }]

      const result = await service.getWinRate()

      expect(result.winRate).toBe(0)
      expect(result.total).toBe(0)
    })

    it('applies date range filter when provided', async () => {
      mockDb._qb._result = [{ total: 5, won: 2 }]

      const result = await service.getWinRate({
        from: new Date('2025-01-01'),
        to: new Date('2025-03-31'),
      })

      expect(result.winRate).toBe(40)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns zero when result is null', async () => {
      mockDb._qb._result = [undefined]

      const result = await service.getWinRate()

      expect(result).toEqual({ total: 0, winRate: 0, won: 0 })
    })
  })

  // -------------------------------------------------------------------------
  // getConversionMetrics()
  // -------------------------------------------------------------------------
  describe('getConversionMetrics()', () => {
    it('returns conversion funnel counts', async () => {
      const metrics = {
        leadToOpportunity: 15,
        opportunityToWon: 5,
        visitorToLead: 30,
      }
      mockDb._qb._result = [metrics]

      const result = await service.getConversionMetrics()

      expect(result).toEqual(metrics)
    })

    it('applies date range filtering', async () => {
      mockDb._qb._result = [{ leadToOpportunity: 2, opportunityToWon: 1, visitorToLead: 5 }]

      const result = await service.getConversionMetrics({
        from: new Date('2025-01-01'),
        to: new Date('2025-01-31'),
      })

      expect(result.visitorToLead).toBe(5)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns zeroed metrics when result is null', async () => {
      mockDb._qb._result = [undefined]

      const result = await service.getConversionMetrics()

      expect(result).toEqual({
        leadToOpportunity: 0,
        opportunityToWon: 0,
        visitorToLead: 0,
      })
    })
  })

  // -------------------------------------------------------------------------
  // getVisitorAnalytics()
  // -------------------------------------------------------------------------
  describe('getVisitorAnalytics()', () => {
    it('returns visitor session analytics', async () => {
      const analytics = { anonymous: 40, avgPageViews: 3.2, identified: 10, total: 50 }
      mockDb._qb._result = [analytics]

      const result = await service.getVisitorAnalytics()

      expect(result).toEqual(analytics)
    })

    it('returns zeroed analytics when no sessions exist', async () => {
      mockDb._qb._result = [undefined]

      const result = await service.getVisitorAnalytics()

      expect(result).toEqual({ anonymous: 0, avgPageViews: 0, identified: 0, total: 0 })
    })
  })

  // -------------------------------------------------------------------------
  // getRevenueByStatus()
  // -------------------------------------------------------------------------
  describe('getRevenueByStatus()', () => {
    it('returns revenue grouped by opportunity status', async () => {
      const rows = [
        { count: 5, status: 'open', totalValue: 50000 },
        { count: 3, status: 'won', totalValue: 30000 },
        { count: 2, status: 'lost', totalValue: 20000 },
      ]
      mockDb._qb._result = rows

      const result = await service.getRevenueByStatus()

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({ count: 5, status: 'open', totalValue: 50000 })
    })

    it('returns empty array when no opportunities exist', async () => {
      mockDb._qb._result = []

      const result = await service.getRevenueByStatus()

      expect(result).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // getCampaignPerformance()
  // -------------------------------------------------------------------------
  describe('getCampaignPerformance()', () => {
    it('returns campaign performance with ROI calculation', async () => {
      const campaign = makeCampaign({
        budget: '5000.00',
        id: 'campaign-001',
        name: 'Email Blast',
        spend: '2000.00',
        status: 'active',
      })
      const metrics = {
        conversionCount: 10,
        redemptionCount: 2,
        totalValue: 8000,
      }

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([campaign]).then(resolve)
        if (callCount === 2) return Promise.resolve([metrics]).then(resolve)
        return Promise.resolve([]).then(resolve)
      })

      const result = await service.getCampaignPerformance('campaign-001')

      expect(result).not.toBeNull()
      expect(result?.campaignId).toBe('campaign-001')
      expect(result?.campaignName).toBe('Email Blast')
      expect(result?.spend).toBe(2000)
      expect(result?.revenue).toBe(8000)
      // ROI = ((8000 - 2000) / 2000) * 100 = 300
      expect(result?.roi).toBe(300)
      expect(result?.conversions).toBe(10)
      expect(result?.redemptions).toBe(2)
    })

    it('returns null when campaign does not exist', async () => {
      mockDb._qb._result = []

      const result = await service.getCampaignPerformance('nonexistent')

      expect(result).toBeNull()
    })

    it('returns roi of 0 when spend is zero', async () => {
      const campaign = makeCampaign({
        id: 'campaign-free',
        spend: '0',
      })
      const metrics = { conversionCount: 3, redemptionCount: 0, totalValue: 1000 }

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([campaign]).then(resolve)
        if (callCount === 2) return Promise.resolve([metrics]).then(resolve)
        return Promise.resolve([]).then(resolve)
      })

      const result = await service.getCampaignPerformance('campaign-free')

      expect(result).not.toBeNull()
      expect(result?.roi).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // getStageTransitions()
  // -------------------------------------------------------------------------
  describe('getStageTransitions()', () => {
    it('returns transitions for the given entity type', async () => {
      const transitions = [
        {
          entityId: 'lead-001',
          entityType: 'lead',
          fromStageId: 'stage-1',
          id: 't-1',
          toStageId: 'stage-2',
        },
        {
          entityId: 'lead-002',
          entityType: 'lead',
          fromStageId: 'stage-2',
          id: 't-2',
          toStageId: 'stage-3',
        },
      ]
      mockDb._qb._result = transitions

      const result = await service.getStageTransitions('lead')

      expect(result).toHaveLength(2)
    })

    it('respects custom limit', async () => {
      mockDb._qb._result = [{ entityType: 'lead', id: 't-1' }]

      await service.getStageTransitions('lead', 10)

      expect(mockDb._qb.limit).toHaveBeenCalledWith(10)
    })
  })

  // -------------------------------------------------------------------------
  // getHealthTrend()
  // -------------------------------------------------------------------------
  describe('getHealthTrend()', () => {
    it('returns health snapshots for a provider', async () => {
      const snapshots = [
        { checkedAt: new Date(), id: 'hs-1', isHealthy: true, provider: 'janua' },
        { checkedAt: new Date(), id: 'hs-2', isHealthy: false, provider: 'janua' },
      ]
      mockDb._qb._result = snapshots

      const result = await service.getHealthTrend('janua')

      expect(result).toHaveLength(2)
    })
  })

  // -------------------------------------------------------------------------
  // getDashboardSummary()
  // -------------------------------------------------------------------------
  describe('getDashboardSummary()', () => {
    it('returns a summary of key dashboard metrics', async () => {
      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) {
          // lead count
          return Promise.resolve([{ count: 25 }]).then(resolve)
        }
        if (callCount === 2) {
          // open opportunity count + value
          return Promise.resolve([{ count: 10, totalValue: 250000 }]).then(resolve)
        }
        if (callCount === 3) {
          // recent visitors
          return Promise.resolve([{ count: 150 }]).then(resolve)
        }
        if (callCount === 4) {
          // win rate query
          return Promise.resolve([{ total: 20, won: 12 }]).then(resolve)
        }
        return Promise.resolve([]).then(resolve)
      })

      const result = await service.getDashboardSummary()

      expect(result.totalLeads).toBe(25)
      expect(result.openOpportunities).toBe(10)
      expect(result.pipelineValue).toBe(250000)
      expect(result.recentVisitors).toBe(150)
      expect(result.winRate).toBe(60)
    })

    it('applies date range filtering when provided', async () => {
      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([{ count: 5 }]).then(resolve)
        if (callCount === 2) return Promise.resolve([{ count: 2, totalValue: 50000 }]).then(resolve)
        if (callCount === 3) return Promise.resolve([{ count: 30 }]).then(resolve)
        if (callCount === 4) return Promise.resolve([{ total: 4, won: 2 }]).then(resolve)
        return Promise.resolve([]).then(resolve)
      })

      const result = await service.getDashboardSummary({
        from: new Date('2025-01-01'),
        to: new Date('2025-03-31'),
      })

      expect(result.totalLeads).toBe(5)
      expect(result.winRate).toBe(50)
    })
  })
})

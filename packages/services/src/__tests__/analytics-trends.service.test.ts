import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsService } from '../analytics/analytics.service'
import { type MockDatabase, createTestContext } from './helpers'

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  desc: vi.fn((col: unknown) => ({ _tag: 'desc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gte: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gte', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
  lte: vi.fn((col: unknown, val: unknown) => ({ _tag: 'lte', col, val })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      _tag: 'sql',
      strings,
      values,
    })),
    {
      join: vi.fn(),
      raw: vi.fn((val: string) => ({ _tag: 'sql.raw', value: val })),
    },
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
    deletedAt: 'opportunities.deletedAt',
    id: 'opportunities.id',
    name: 'opportunities.name',
    pipelineId: 'opportunities.pipelineId',
    probability: 'opportunities.probability',
    stageId: 'opportunities.stageId',
    status: 'opportunities.status',
    updatedAt: 'opportunities.updatedAt',
    value: 'opportunities.value',
  },
  orders: {
    deletedAt: 'orders.deletedAt',
    status: 'orders.status',
  },
  pipelineStages: {
    id: 'pipelineStages.id',
    name: 'pipelineStages.name',
    pipelineId: 'pipelineStages.pipelineId',
    position: 'pipelineStages.position',
  },
  quotes: {
    deletedAt: 'quotes.deletedAt',
    status: 'quotes.status',
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

describe('AnalyticsService — Trends', () => {
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
  // getLeadTrend()
  // -------------------------------------------------------------------------
  describe('getLeadTrend()', () => {
    it('returns period and count data', async () => {
      const rows = [
        { count: 5, period: '2025-01-01' },
        { count: 12, period: '2025-02-01' },
        { count: 8, period: '2025-03-01' },
      ]
      mockDb._qb._result = rows

      const result = await service.getLeadTrend(
        { from: new Date('2025-01-01'), to: new Date('2025-03-31') },
        'month',
      )

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({ count: 5, period: '2025-01-01' })
      expect(result[2]).toEqual({ count: 8, period: '2025-03-01' })
    })

    it('returns empty array when no leads exist', async () => {
      mockDb._qb._result = []

      const result = await service.getLeadTrend(
        { from: new Date('2025-01-01'), to: new Date('2025-03-31') },
        'week',
      )

      expect(result).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // getOpportunityTrend()
  // -------------------------------------------------------------------------
  describe('getOpportunityTrend()', () => {
    it('returns period, count, and totalValue', async () => {
      const rows = [
        { count: 3, period: '2025-01-01', totalValue: 50000 },
        { count: 7, period: '2025-01-08', totalValue: 120000 },
      ]
      mockDb._qb._result = rows

      const result = await service.getOpportunityTrend(
        { from: new Date('2025-01-01'), to: new Date('2025-01-31') },
        'week',
      )

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ count: 3, period: '2025-01-01', totalValue: 50000 })
      expect(result[1]).toEqual({ count: 7, period: '2025-01-08', totalValue: 120000 })
    })

    it('returns empty array when no opportunities exist', async () => {
      mockDb._qb._result = []

      const result = await service.getOpportunityTrend(
        { from: new Date('2025-06-01'), to: new Date('2025-06-30') },
        'day',
      )

      expect(result).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // getConversionTrend()
  // -------------------------------------------------------------------------
  describe('getConversionTrend()', () => {
    it('returns period with conversion type counts', async () => {
      const rows = [
        { leadToOpp: 4, oppToWon: 1, period: '2025-01-01', visitorToLead: 10 },
        { leadToOpp: 6, oppToWon: 3, period: '2025-02-01', visitorToLead: 15 },
      ]
      mockDb._qb._result = rows

      const result = await service.getConversionTrend(
        { from: new Date('2025-01-01'), to: new Date('2025-02-28') },
        'month',
      )

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        leadToOpp: 4,
        oppToWon: 1,
        period: '2025-01-01',
        visitorToLead: 10,
      })
      expect(result[1]?.visitorToLead).toBe(15)
      expect(result[1]?.leadToOpp).toBe(6)
      expect(result[1]?.oppToWon).toBe(3)
    })

    it('returns empty array when no conversions exist', async () => {
      mockDb._qb._result = []

      const result = await service.getConversionTrend(
        { from: new Date('2025-01-01'), to: new Date('2025-01-31') },
        'day',
      )

      expect(result).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // getVisitorTrend()
  // -------------------------------------------------------------------------
  describe('getVisitorTrend()', () => {
    it('returns period with total and identified counts', async () => {
      const rows = [
        { identified: 3, period: '2025-01-01', total: 20 },
        { identified: 8, period: '2025-01-08', total: 35 },
      ]
      mockDb._qb._result = rows

      const result = await service.getVisitorTrend(
        { from: new Date('2025-01-01'), to: new Date('2025-01-31') },
        'week',
      )

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ identified: 3, period: '2025-01-01', total: 20 })
      expect(result[1]?.total).toBe(35)
      expect(result[1]?.identified).toBe(8)
    })

    it('returns empty array when no sessions exist', async () => {
      mockDb._qb._result = []

      const result = await service.getVisitorTrend(
        { from: new Date('2025-06-01'), to: new Date('2025-06-30') },
        'month',
      )

      expect(result).toHaveLength(0)
    })
  })
})

import {
  campaigns,
  conversions,
  healthSnapshots,
  leads,
  opportunities,
  pipelineStages,
  stageTransitions,
  visitorSessions,
} from '@phyne/db/schema'
import type { SQL } from 'drizzle-orm'
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'

interface DateRange {
  from?: Date
  to?: Date
}

export class AnalyticsService {
  constructor(private readonly ctx: ServiceContext) {}

  async getPipelineVelocity(pipelineId: string, dateRange?: DateRange) {
    const conditions: SQL[] = [eq(opportunities.pipelineId, pipelineId)]
    if (dateRange?.from) {
      conditions.push(gte(opportunities.createdAt, dateRange.from))
    }
    if (dateRange?.to) {
      conditions.push(lte(opportunities.createdAt, dateRange.to))
    }

    const [result] = await this.ctx.db
      .select({
        avgDaysInPipeline: sql<number>`coalesce(avg(extract(epoch from (${opportunities.updatedAt} - ${opportunities.createdAt})) / 86400), 0)::numeric(10,1)`,
        totalOpportunities: sql<number>`count(*)::int`,
        wonCount: sql<number>`count(*) filter (where ${opportunities.status} = 'won')::int`,
        lostCount: sql<number>`count(*) filter (where ${opportunities.status} = 'lost')::int`,
      })
      .from(opportunities)
      .where(and(...conditions))

    return result ?? { avgDaysInPipeline: 0, totalOpportunities: 0, wonCount: 0, lostCount: 0 }
  }

  async getStageVelocity(pipelineId: string, dateRange?: DateRange) {
    const conditions: SQL[] = [eq(pipelineStages.pipelineId, pipelineId)]
    if (dateRange?.from) {
      conditions.push(gte(stageTransitions.transitionedAt, dateRange.from))
    }
    if (dateRange?.to) {
      conditions.push(lte(stageTransitions.transitionedAt, dateRange.to))
    }

    // Compute average time-in-stage by joining consecutive transitions
    // For each transition, duration = this transition time - previous transition time (or entity creation)
    const rows = await this.ctx.db
      .select({
        stageId: stageTransitions.toStageId,
        stageName: pipelineStages.name,
        avgDays: sql<number>`coalesce(avg(extract(epoch from (
          lead(${stageTransitions.transitionedAt}) over (
            partition by ${stageTransitions.entityType}, ${stageTransitions.entityId}
            order by ${stageTransitions.transitionedAt}
          ) - ${stageTransitions.transitionedAt}
        )) / 86400), 0)::numeric(10,1)`,
        transitionCount: sql<number>`count(*)::int`,
      })
      .from(stageTransitions)
      .innerJoin(pipelineStages, eq(stageTransitions.toStageId, pipelineStages.id))
      .where(and(...conditions))
      .groupBy(stageTransitions.toStageId, pipelineStages.name, pipelineStages.position)
      .orderBy(pipelineStages.position)

    return rows
  }

  async getWinRate(dateRange?: DateRange) {
    const conditions: SQL[] = []
    if (dateRange?.from) {
      conditions.push(gte(opportunities.createdAt, dateRange.from))
    }
    if (dateRange?.to) {
      conditions.push(lte(opportunities.createdAt, dateRange.to))
    }

    const [result] = await this.ctx.db
      .select({
        total: sql<number>`count(*) filter (where ${opportunities.status} in ('won', 'lost'))::int`,
        won: sql<number>`count(*) filter (where ${opportunities.status} = 'won')::int`,
      })
      .from(opportunities)
      .where(conditions.length > 0 ? and(...conditions) : undefined)

    if (!result || result.total === 0) return { winRate: 0, total: 0, won: 0 }
    return {
      winRate: Number(((result.won / result.total) * 100).toFixed(1)),
      total: result.total,
      won: result.won,
    }
  }

  async getConversionMetrics(dateRange?: DateRange) {
    const conditions: SQL[] = []
    if (dateRange?.from) {
      conditions.push(gte(conversions.convertedAt, dateRange.from))
    }
    if (dateRange?.to) {
      conditions.push(lte(conversions.convertedAt, dateRange.to))
    }

    const [result] = await this.ctx.db
      .select({
        visitorToLead: sql<number>`count(*) filter (where ${conversions.type} = 'visitor_to_lead')::int`,
        leadToOpportunity: sql<number>`count(*) filter (where ${conversions.type} = 'lead_to_opportunity')::int`,
        opportunityToWon: sql<number>`count(*) filter (where ${conversions.type} = 'opportunity_to_won')::int`,
      })
      .from(conversions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)

    return result ?? { visitorToLead: 0, leadToOpportunity: 0, opportunityToWon: 0 }
  }

  async getVisitorAnalytics(dateRange?: DateRange) {
    const conditions: SQL[] = []
    if (dateRange?.from) {
      conditions.push(gte(visitorSessions.createdAt, dateRange.from))
    }
    if (dateRange?.to) {
      conditions.push(lte(visitorSessions.createdAt, dateRange.to))
    }

    const [result] = await this.ctx.db
      .select({
        total: sql<number>`count(*)::int`,
        identified: sql<number>`count(*) filter (where ${visitorSessions.identified} = true)::int`,
        anonymous: sql<number>`count(*) filter (where ${visitorSessions.identified} = false)::int`,
        avgPageViews: sql<number>`coalesce(avg(${visitorSessions.pageViewCount}), 0)::numeric(10,1)`,
      })
      .from(visitorSessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)

    return result ?? { total: 0, identified: 0, anonymous: 0, avgPageViews: 0 }
  }

  async getRevenueByStatus() {
    return this.ctx.db
      .select({
        status: opportunities.status,
        totalValue: sql<number>`coalesce(sum(${opportunities.value}::numeric), 0)::numeric`,
        count: sql<number>`count(*)::int`,
      })
      .from(opportunities)
      .groupBy(opportunities.status)
  }

  async getStageTransitions(entityType: string, limit = 50) {
    return this.ctx.db
      .select()
      .from(stageTransitions)
      .where(eq(stageTransitions.entityType, entityType))
      .orderBy(desc(stageTransitions.transitionedAt))
      .limit(limit)
  }

  async getHealthTrend(provider: string, limit = 50) {
    return this.ctx.db
      .select()
      .from(healthSnapshots)
      .where(eq(healthSnapshots.provider, provider))
      .orderBy(desc(healthSnapshots.checkedAt))
      .limit(limit)
  }

  async getCampaignPerformance(campaignId: string) {
    const [campaign] = await this.ctx.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))

    if (!campaign) return null

    const [metrics] = await this.ctx.db
      .select({
        conversionCount: sql<number>`count(*)::int`,
        totalValue: sql<number>`coalesce(sum(${conversions.value}::numeric), 0)::numeric`,
        redemptionCount: sql<number>`count(*) filter (where ${conversions.type} = 'offer_redemption')::int`,
      })
      .from(conversions)
      .where(eq(conversions.campaignId, campaignId))

    const spend = Number(campaign.spend ?? 0)
    const revenue = Number(metrics?.totalValue ?? 0)
    const roi = spend > 0 ? Number((((revenue - spend) / spend) * 100).toFixed(1)) : 0

    return {
      campaignId,
      campaignName: campaign.name,
      status: campaign.status,
      budget: Number(campaign.budget ?? 0),
      spend,
      revenue,
      roi,
      conversions: metrics?.conversionCount ?? 0,
      redemptions: metrics?.redemptionCount ?? 0,
    }
  }

  async getAllCampaignPerformance() {
    const rows = await this.ctx.db
      .select({
        campaignId: campaigns.id,
        campaignName: campaigns.name,
        status: campaigns.status,
        budget: campaigns.budget,
        spend: campaigns.spend,
        conversionCount: sql<number>`count(${conversions.id})::int`,
        totalValue: sql<number>`coalesce(sum(${conversions.value}::numeric), 0)::numeric`,
        redemptionCount: sql<number>`count(*) filter (where ${conversions.type} = 'offer_redemption')::int`,
      })
      .from(campaigns)
      .leftJoin(conversions, eq(conversions.campaignId, campaigns.id))
      .groupBy(campaigns.id)

    return rows.map((row) => {
      const spend = Number(row.spend ?? 0)
      const revenue = Number(row.totalValue)
      const roi = spend > 0 ? Number((((revenue - spend) / spend) * 100).toFixed(1)) : 0
      return {
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        status: row.status,
        budget: Number(row.budget ?? 0),
        spend,
        revenue,
        roi,
        conversions: row.conversionCount,
        redemptions: row.redemptionCount,
      }
    })
  }

  async getWeightedPipelineValue() {
    const [result] = await this.ctx.db
      .select({
        weightedValue: sql<number>`coalesce(sum(${opportunities.value}::numeric * coalesce(${opportunities.probability}, 50) / 100), 0)::numeric(12,2)`,
        rawValue: sql<number>`coalesce(sum(${opportunities.value}::numeric), 0)::numeric(12,2)`,
        count: sql<number>`count(*)::int`,
      })
      .from(opportunities)
      .where(and(eq(opportunities.status, 'open'), isNull(opportunities.deletedAt)))

    return {
      weightedValue: Number(result?.weightedValue ?? 0),
      rawValue: Number(result?.rawValue ?? 0),
      count: result?.count ?? 0,
    }
  }

  async getAtRiskDeals(staleThresholdDays = 14) {
    // Get open, non-deleted opportunities
    const openOpps = await this.ctx.db
      .select({
        id: opportunities.id,
        name: opportunities.name,
        value: opportunities.value,
        stageId: opportunities.stageId,
        pipelineId: opportunities.pipelineId,
      })
      .from(opportunities)
      .where(and(eq(opportunities.status, 'open'), isNull(opportunities.deletedAt)))

    if (openOpps.length === 0) return []

    // Get latest stage transition per entity to compute days-in-stage
    const transitions = await this.ctx.db
      .select({
        entityId: stageTransitions.entityId,
        toStageId: stageTransitions.toStageId,
        transitionedAt: stageTransitions.transitionedAt,
      })
      .from(stageTransitions)
      .where(eq(stageTransitions.entityType, 'opportunity'))
      .orderBy(desc(stageTransitions.transitionedAt))

    // Get stage names
    const allStages = await this.ctx.db.select().from(pipelineStages)
    const stageMap = new Map(allStages.map((s) => [s.id, s.name]))

    // Compute avg days per stage
    const stageDurations: Record<string, number[]> = {}
    const latestTransitionByOpp = new Map<string, Date>()

    for (const t of transitions) {
      if (!latestTransitionByOpp.has(t.entityId)) {
        latestTransitionByOpp.set(t.entityId, t.transitionedAt)
      }
    }

    // Compute average stage velocity from all transitions
    const transitionsByEntity = new Map<string, typeof transitions>()
    for (const t of transitions) {
      const existing = transitionsByEntity.get(t.entityId) ?? []
      existing.push(t)
      transitionsByEntity.set(t.entityId, existing)
    }

    for (const [, entityTransitions] of transitionsByEntity) {
      for (let i = 0; i < entityTransitions.length - 1; i++) {
        const current = entityTransitions[i]
        const next = entityTransitions[i + 1]
        if (!current || !next) continue
        const days =
          (current.transitionedAt.getTime() - next.transitionedAt.getTime()) / (1000 * 60 * 60 * 24)
        const stageId = current.toStageId
        if (!stageDurations[stageId]) stageDurations[stageId] = []
        stageDurations[stageId].push(days)
      }
    }

    const stageAvgDays = new Map<string, number>()
    for (const [stageId, durations] of Object.entries(stageDurations)) {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length
      stageAvgDays.set(stageId, avg)
    }

    const now = new Date()
    const atRisk: {
      opportunityId: string
      name: string
      value: number
      stageName: string
      daysInStage: number
      averageDays: number
      riskLevel: 'warning' | 'critical'
    }[] = []

    for (const opp of openOpps) {
      const lastTransition = latestTransitionByOpp.get(opp.id)
      if (!lastTransition) continue

      const daysInStage = Math.floor(
        (now.getTime() - lastTransition.getTime()) / (1000 * 60 * 60 * 24),
      )
      const avgDays = stageAvgDays.get(opp.stageId) ?? staleThresholdDays
      const isStale = daysInStage > staleThresholdDays || daysInStage > avgDays * 1.5

      if (isStale) {
        atRisk.push({
          opportunityId: opp.id,
          name: opp.name,
          value: Number(opp.value ?? 0),
          stageName: stageMap.get(opp.stageId) ?? 'Unknown',
          daysInStage,
          averageDays: Math.round(avgDays),
          riskLevel:
            daysInStage > avgDays * 2 || daysInStage > staleThresholdDays * 2
              ? 'critical'
              : 'warning',
        })
      }
    }

    return atRisk.sort((a, b) => b.daysInStage - a.daysInStage)
  }

  async getDashboardSummary(dateRange?: DateRange) {
    const leadConditions: SQL[] = []
    if (dateRange?.from) {
      leadConditions.push(gte(leads.createdAt, dateRange.from))
    }
    if (dateRange?.to) {
      leadConditions.push(lte(leads.createdAt, dateRange.to))
    }

    const [leadCount] = await this.ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(leadConditions.length > 0 ? and(...leadConditions) : undefined)

    const oppConditions: SQL[] = [eq(opportunities.status, 'open')]
    if (dateRange?.from) {
      oppConditions.push(gte(opportunities.createdAt, dateRange.from))
    }
    if (dateRange?.to) {
      oppConditions.push(lte(opportunities.createdAt, dateRange.to))
    }

    const [oppCount] = await this.ctx.db
      .select({
        count: sql<number>`count(*)::int`,
        totalValue: sql<number>`coalesce(sum(${opportunities.value}::numeric), 0)::numeric`,
      })
      .from(opportunities)
      .where(and(...oppConditions))

    const visitorConditions: SQL[] = [
      gte(visitorSessions.startedAt, sql`now() - interval '7 days'`),
    ]
    if (dateRange?.from) {
      visitorConditions.push(gte(visitorSessions.createdAt, dateRange.from))
    }
    if (dateRange?.to) {
      visitorConditions.push(lte(visitorSessions.createdAt, dateRange.to))
    }

    const [recentVisitors] = await this.ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(visitorSessions)
      .where(and(...visitorConditions))

    const [winRate, weighted] = await Promise.all([
      this.getWinRate(dateRange),
      this.getWeightedPipelineValue(),
    ])

    return {
      totalLeads: leadCount?.count ?? 0,
      openOpportunities: oppCount?.count ?? 0,
      pipelineValue: oppCount?.totalValue ?? 0,
      weightedPipelineValue: weighted.weightedValue,
      recentVisitors: recentVisitors?.count ?? 0,
      winRate: winRate.winRate,
    }
  }
}

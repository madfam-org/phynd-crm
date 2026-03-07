import {
  conversions,
  healthSnapshots,
  leads,
  opportunities,
  stageTransitions,
  visitorSessions,
} from '@phyne/db/schema'
import { desc, eq, gte, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class AnalyticsService {
  constructor(private readonly ctx: ServiceContext) {}

  async getPipelineVelocity(pipelineId: string) {
    const [result] = await this.ctx.db
      .select({
        avgDaysInPipeline: sql<number>`coalesce(avg(extract(epoch from (${opportunities.updatedAt} - ${opportunities.createdAt})) / 86400), 0)::numeric(10,1)`,
        totalOpportunities: sql<number>`count(*)::int`,
        wonCount: sql<number>`count(*) filter (where ${opportunities.status} = 'won')::int`,
        lostCount: sql<number>`count(*) filter (where ${opportunities.status} = 'lost')::int`,
      })
      .from(opportunities)
      .where(eq(opportunities.pipelineId, pipelineId))

    return result ?? { avgDaysInPipeline: 0, totalOpportunities: 0, wonCount: 0, lostCount: 0 }
  }

  async getWinRate() {
    const [result] = await this.ctx.db
      .select({
        total: sql<number>`count(*) filter (where ${opportunities.status} in ('won', 'lost'))::int`,
        won: sql<number>`count(*) filter (where ${opportunities.status} = 'won')::int`,
      })
      .from(opportunities)

    if (!result || result.total === 0) return { winRate: 0, total: 0, won: 0 }
    return {
      winRate: Number(((result.won / result.total) * 100).toFixed(1)),
      total: result.total,
      won: result.won,
    }
  }

  async getConversionMetrics() {
    const [result] = await this.ctx.db
      .select({
        visitorToLead: sql<number>`count(*) filter (where ${conversions.type} = 'visitor_to_lead')::int`,
        leadToOpportunity: sql<number>`count(*) filter (where ${conversions.type} = 'lead_to_opportunity')::int`,
        opportunityToWon: sql<number>`count(*) filter (where ${conversions.type} = 'opportunity_to_won')::int`,
      })
      .from(conversions)

    return result ?? { visitorToLead: 0, leadToOpportunity: 0, opportunityToWon: 0 }
  }

  async getVisitorAnalytics() {
    const [result] = await this.ctx.db
      .select({
        total: sql<number>`count(*)::int`,
        identified: sql<number>`count(*) filter (where ${visitorSessions.identified} = true)::int`,
        anonymous: sql<number>`count(*) filter (where ${visitorSessions.identified} = false)::int`,
        avgPageViews: sql<number>`coalesce(avg(${visitorSessions.pageViewCount}), 0)::numeric(10,1)`,
      })
      .from(visitorSessions)

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

  async getDashboardSummary() {
    const [leadCount] = await this.ctx.db.select({ count: sql<number>`count(*)::int` }).from(leads)

    const [oppCount] = await this.ctx.db
      .select({
        count: sql<number>`count(*)::int`,
        totalValue: sql<number>`coalesce(sum(${opportunities.value}::numeric), 0)::numeric`,
      })
      .from(opportunities)
      .where(eq(opportunities.status, 'open'))

    const [recentVisitors] = await this.ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(visitorSessions)
      .where(gte(visitorSessions.startedAt, sql`now() - interval '7 days'`))

    const winRate = await this.getWinRate()

    return {
      totalLeads: leadCount?.count ?? 0,
      openOpportunities: oppCount?.count ?? 0,
      pipelineValue: oppCount?.totalValue ?? 0,
      recentVisitors: recentVisitors?.count ?? 0,
      winRate: winRate.winRate,
    }
  }
}

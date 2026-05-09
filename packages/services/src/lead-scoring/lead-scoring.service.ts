import {
  leadScores,
  leadScoringRules,
  leads,
  visitorPageViews,
  visitorSessions,
} from '@phynd/db/schema'
import type { PaginatedResult, PaginationInput, ScoringCondition } from '@phynd/types/crm'
import { and, eq, gt, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class LeadScoringService {
  constructor(private readonly ctx: ServiceContext) {}

  async listRules(
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<typeof leadScoringRules.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = []
    if (pagination?.cursor) {
      conditions.push(gt(leadScoringRules.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(leadScoringRules)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(leadScoringRules.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async createRule(data: {
    name: string
    category: string
    condition: ScoringCondition
    points: number
    isActive?: boolean
  }) {
    const [rule] = await this.ctx.db.insert(leadScoringRules).values(data).returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return rule!
  }

  async updateRule(
    id: string,
    data: Partial<{
      name: string
      category: string
      condition: ScoringCondition
      points: number
      isActive: boolean
    }>,
  ) {
    const [rule] = await this.ctx.db
      .update(leadScoringRules)
      .set(data)
      .where(eq(leadScoringRules.id, id))
      .returning()
    return rule ?? null
  }

  async deleteRule(id: string) {
    const [deleted] = await this.ctx.db
      .delete(leadScoringRules)
      .where(eq(leadScoringRules.id, id))
      .returning()
    return deleted ?? null
  }

  async computeScore(leadId: string) {
    const [lead] = await this.ctx.db.select().from(leads).where(eq(leads.id, leadId))
    if (!lead) return null

    const rules = await this.ctx.db
      .select()
      .from(leadScoringRules)
      .where(eq(leadScoringRules.isActive, true))

    const visitorData = await this.fetchVisitorData(lead.contactId)
    const scores = this.computeCategoryScores(rules, lead, visitorData)

    return this.upsertScore(leadId, scores)
  }

  private async fetchVisitorData(contactId: string | null) {
    const empty = { sessionCount: 0, totalPageViews: 0, pageUrls: [] as string[] }
    if (!contactId) return empty

    const sessions = await this.ctx.db
      .select({
        count: sql<number>`count(*)::int`,
        pageViews: sql<number>`coalesce(sum(${visitorSessions.pageViewCount}), 0)::int`,
      })
      .from(visitorSessions)
      .where(eq(visitorSessions.contactId, contactId))

    const sessionCount = sessions[0]?.count ?? 0
    const totalPageViews = sessions[0]?.pageViews ?? 0

    const sessionIds = await this.ctx.db
      .select({ id: visitorSessions.id })
      .from(visitorSessions)
      .where(eq(visitorSessions.contactId, contactId))

    if (sessionIds.length === 0) return { sessionCount, totalPageViews, pageUrls: [] as string[] }

    const pages = await this.ctx.db
      .select({ url: visitorPageViews.url })
      .from(visitorPageViews)
      .where(
        sql`${visitorPageViews.sessionId} in (${sql.join(
          sessionIds.map((s) => sql`${s.id}`),
          sql`, `,
        )})`,
      )

    return { sessionCount, totalPageViews, pageUrls: pages.map((p) => p.url) }
  }

  private matchCondition(
    condition: ScoringCondition,
    lead: { source: string | null; status: string; contactId: string | null },
    visitorData: { sessionCount: number; totalPageViews: number; pageUrls: string[] },
  ): boolean {
    switch (condition.field) {
      case 'source':
        return this.evaluateCondition(lead.source, condition)
      case 'status':
        return this.evaluateCondition(lead.status, condition)
      case 'session_count':
        return this.evaluateCondition(visitorData.sessionCount, condition)
      case 'page_view_count':
        return this.evaluateCondition(visitorData.totalPageViews, condition)
      case 'has_contact':
        return condition.operator === 'exists' ? lead.contactId != null : false
      case 'page_url':
        return this.matchPageUrl(condition, visitorData.pageUrls)
      case '3d_asset_views': {
        const count = visitorData.pageUrls.filter((url) => url.startsWith('forj://')).length
        return this.evaluateCondition(count, condition)
      }
      default:
        return false
    }
  }

  private matchPageUrl(condition: ScoringCondition, pageUrls: string[]): boolean {
    if (condition.operator === 'contains' && typeof condition.value === 'string') {
      return pageUrls.some((url) => url.includes(condition.value as string))
    }
    if (condition.operator === 'eq' && typeof condition.value === 'string') {
      return pageUrls.some((url) => url === condition.value)
    }
    return false
  }

  private addToCategory(
    category: string,
    points: number,
    scores: { demographic: number; behavior: number; engagement: number },
  ) {
    switch (category) {
      case 'demographic':
        scores.demographic += points
        break
      case 'behavior':
        scores.behavior += points
        break
      default:
        scores.engagement += points
    }
  }

  private computeCategoryScores(
    rules: { id: string; points: number; category: string; condition: unknown }[],
    lead: { source: string | null; status: string; contactId: string | null },
    visitorData: { sessionCount: number; totalPageViews: number; pageUrls: string[] },
  ) {
    const scores = { demographic: 0, behavior: 0, engagement: 0 }
    const breakdown: Record<string, number> = {}

    for (const rule of rules) {
      const condition = rule.condition as ScoringCondition
      if (this.matchCondition(condition, lead, visitorData)) {
        breakdown[rule.id] = rule.points
        this.addToCategory(rule.category, rule.points, scores)
      }
    }

    return {
      demographicScore: scores.demographic,
      behaviorScore: scores.behavior,
      engagementScore: scores.engagement,
      totalScore: scores.demographic + scores.behavior + scores.engagement,
      breakdown,
    }
  }

  private async upsertScore(
    leadId: string,
    scores: {
      totalScore: number
      demographicScore: number
      behaviorScore: number
      engagementScore: number
      breakdown: Record<string, number>
    },
  ) {
    const existing = await this.ctx.db
      .select()
      .from(leadScores)
      .where(eq(leadScores.leadId, leadId))
      .limit(1)

    if (existing.length > 0) {
      const [updated] = await this.ctx.db
        .update(leadScores)
        .set({ ...scores, computedAt: new Date() })
        .where(eq(leadScores.leadId, leadId))
        .returning()
      return updated ?? null
    }

    const [created] = await this.ctx.db
      .insert(leadScores)
      .values({ leadId, ...scores })
      .returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return created!
  }

  async getScore(leadId: string) {
    const [score] = await this.ctx.db.select().from(leadScores).where(eq(leadScores.leadId, leadId))
    return score ?? null
  }

  async batchCompute(leadIds: string[]) {
    const results = []
    for (const id of leadIds) {
      const score = await this.computeScore(id)
      if (score) results.push(score)
    }
    return results
  }

  private evaluateCondition(value: unknown, condition: ScoringCondition): boolean {
    switch (condition.operator) {
      case 'eq':
        return value === condition.value
      case 'gt':
        return typeof value === 'number' && value > (condition.value as number)
      case 'lt':
        return typeof value === 'number' && value < (condition.value as number)
      case 'gte':
        return typeof value === 'number' && value >= (condition.value as number)
      case 'lte':
        return typeof value === 'number' && value <= (condition.value as number)
      case 'contains':
        return typeof value === 'string' && value.includes(condition.value as string)
      case 'exists':
        return value != null
      default:
        return false
    }
  }
}

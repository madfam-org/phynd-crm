import { leadScores, leadScoringRules, leads, visitorSessions } from '@phyne/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export interface ScoringCondition {
  field: string
  operator: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'exists'
  value?: unknown
}

export class LeadScoringService {
  constructor(private readonly ctx: ServiceContext) {}

  async listRules() {
    return this.ctx.db.select().from(leadScoringRules).orderBy(leadScoringRules.category)
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

    let demographicScore = 0
    let behaviorScore = 0
    let engagementScore = 0
    const breakdown: Record<string, number> = {}

    // Get visitor session data for behavior scoring
    let sessionCount = 0
    let totalPageViews = 0
    if (lead.contactId) {
      const sessions = await this.ctx.db
        .select({
          count: sql<number>`count(*)::int`,
          pageViews: sql<number>`coalesce(sum(${visitorSessions.pageViewCount}), 0)::int`,
        })
        .from(visitorSessions)
        .where(eq(visitorSessions.contactId, lead.contactId))
      if (sessions[0]) {
        sessionCount = sessions[0].count
        totalPageViews = sessions[0].pageViews
      }
    }

    for (const rule of rules) {
      const condition = rule.condition as ScoringCondition
      let matches = false

      switch (condition.field) {
        case 'source':
          matches = this.evaluateCondition(lead.source, condition)
          break
        case 'status':
          matches = this.evaluateCondition(lead.status, condition)
          break
        case 'session_count':
          matches = this.evaluateCondition(sessionCount, condition)
          break
        case 'page_view_count':
          matches = this.evaluateCondition(totalPageViews, condition)
          break
        case 'has_contact':
          matches = condition.operator === 'exists' ? lead.contactId != null : false
          break
      }

      if (matches) {
        breakdown[rule.name] = rule.points

        switch (rule.category) {
          case 'demographic':
            demographicScore += rule.points
            break
          case 'behavior':
            behaviorScore += rule.points
            break
          case 'engagement':
            engagementScore += rule.points
            break
          default:
            engagementScore += rule.points
        }
      }
    }

    const totalScore = demographicScore + behaviorScore + engagementScore

    // Upsert the score
    const existing = await this.ctx.db
      .select()
      .from(leadScores)
      .where(eq(leadScores.leadId, leadId))
      .limit(1)

    if (existing.length > 0) {
      const [updated] = await this.ctx.db
        .update(leadScores)
        .set({
          totalScore,
          demographicScore,
          behaviorScore,
          engagementScore,
          breakdown,
          computedAt: new Date(),
        })
        .where(eq(leadScores.leadId, leadId))
        .returning()
      return updated ?? null
    }

    const [created] = await this.ctx.db
      .insert(leadScores)
      .values({
        leadId,
        totalScore,
        demographicScore,
        behaviorScore,
        engagementScore,
        breakdown,
      })
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

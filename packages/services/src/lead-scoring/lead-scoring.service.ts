import {
  contacts,
  leadScores,
  leadScoringRules,
  leads,
  visitorPageViews,
  visitorSessions,
} from '@phynd/db/schema'
import type { PaginatedResult, PaginationInput, ScoringCondition } from '@phynd/types/crm'
import { and, eq, gt, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { isFreeMailAddress, tierForScore } from '../leads/lead-qualification'

/** Window in which earlier submissions by the same contact count as repeats. */
export const REPEAT_SUBMISSION_WINDOW_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/** What the scoring rules can read about a lead beyond its own columns. */
export interface LeadScoringFacts {
  /** `attribution.intent`, as the sender reported it. */
  intent: string | undefined
  /** `attribution.interests`. */
  interests: string[]
  /** True at a free-mail provider, false at any other domain, null without an address. */
  emailFreeMail: boolean | null
  /** The contact has a phone number. */
  hasPhone: boolean
  /** Whole days since the lead was created. */
  leadAgeDays: number
  /** Earlier leads by the same contact in the 7 days before this one (test leads excluded). */
  repeatSubmissions7d: number
}

/** Fields that need the contact row, and the one that needs a count of other leads. */
const CONTACT_FIELDS = new Set(['email_free_mail', 'has_phone'])
const REPEAT_FIELD = 'repeat_submissions_7d'

type ScoredLead = {
  id?: string
  source: string | null
  status: string
  contactId: string | null
  attribution?: unknown
  createdAt?: Date | null
}

function conditionFields(condition: ScoringCondition): string[] {
  return [condition.field, ...(condition.all ?? []).flatMap(conditionFields)]
}

function attributionOf(lead: ScoredLead): { intent?: unknown; interests?: unknown } {
  const value = lead.attribution
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { intent?: unknown; interests?: unknown })
    : {}
}

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
    const facts = await this.fetchLeadFacts(lead, rules)
    const scores = this.computeCategoryScores(rules, lead, visitorData, facts)

    const result = await this.upsertScore(leadId, scores)
    await this.writeLeadScore(leadId, scores.totalScore, facts.intent)
    return result
  }

  /**
   * The score and tier on the lead row itself, so lists filter and sort on
   * them without a join. Never below 0; the tier follows `tierForScore`.
   */
  private async writeLeadScore(leadId: string, totalScore: number, intent: string | undefined) {
    const score = Math.max(0, totalScore)
    await this.ctx.db
      .update(leads)
      .set({ score, tier: tierForScore(score, intent) })
      .where(eq(leads.id, leadId))
  }

  /**
   * Facts for the rules. The contact and the repeat count are read only when an
   * active rule uses them, so a rule set without them costs no extra query.
   */
  private async fetchLeadFacts(
    lead: ScoredLead,
    rules: { condition: unknown }[],
  ): Promise<LeadScoringFacts> {
    const fields = new Set(
      rules.flatMap((rule) =>
        rule.condition && typeof rule.condition === 'object'
          ? conditionFields(rule.condition as ScoringCondition)
          : [],
      ),
    )
    const attribution = attributionOf(lead)
    const createdAt = lead.createdAt instanceof Date ? lead.createdAt : new Date()
    const facts: LeadScoringFacts = {
      intent: typeof attribution.intent === 'string' ? attribution.intent : undefined,
      interests: Array.isArray(attribution.interests)
        ? attribution.interests.filter((item): item is string => typeof item === 'string')
        : [],
      emailFreeMail: null,
      hasPhone: false,
      leadAgeDays: Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / DAY_MS)),
      repeatSubmissions7d: 0,
    }

    if (lead.contactId && [...fields].some((field) => CONTACT_FIELDS.has(field))) {
      const [contact] = await this.ctx.db
        .select({ email: contacts.email, phone: contacts.phone })
        .from(contacts)
        .where(eq(contacts.id, lead.contactId))
        .limit(1)
      facts.emailFreeMail = isFreeMailAddress(contact?.email)
      facts.hasPhone = typeof contact?.phone === 'string' && contact.phone.trim() !== ''
    }

    if (lead.contactId && lead.id && fields.has(REPEAT_FIELD)) {
      const since = new Date(createdAt.getTime() - REPEAT_SUBMISSION_WINDOW_DAYS * DAY_MS)
      const [row] = await this.ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(leads)
        .where(
          and(
            eq(leads.contactId, lead.contactId),
            sql`${leads.id} <> ${lead.id}`,
            sql`${leads.deletedAt} is null`,
            eq(leads.isTest, false),
            sql`${leads.createdAt} >= ${since}`,
            sql`${leads.createdAt} <= ${createdAt}`,
          ),
        )
      facts.repeatSubmissions7d = row?.count ?? 0
    }

    return facts
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
    lead: ScoredLead,
    visitorData: { sessionCount: number; totalPageViews: number; pageUrls: string[] },
    facts: LeadScoringFacts,
  ): boolean {
    // Every condition in `all` must hold as well.
    if (
      condition.all &&
      !condition.all.every((sub) => this.matchCondition(sub, lead, visitorData, facts))
    ) {
      return false
    }
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
      case 'intent':
        return this.evaluateCondition(facts.intent, condition)
      case 'interests':
        return this.matchInterests(condition, facts.interests)
      case 'email_free_mail':
        return this.evaluateCondition(facts.emailFreeMail, condition)
      case 'has_phone':
        return condition.operator === 'exists'
          ? facts.hasPhone
          : this.evaluateCondition(facts.hasPhone, condition)
      case 'lead_age_days':
        return this.evaluateCondition(facts.leadAgeDays, condition)
      case 'repeat_submissions_7d':
        return this.evaluateCondition(facts.repeatSubmissions7d, condition)
      default:
        return false
    }
  }

  /** `contains`: one interest equals the value; `in`: one interest is in the list (no letter case). */
  private matchInterests(condition: ScoringCondition, interests: string[]): boolean {
    const wanted = interests.map((item) => item.trim().toLowerCase())
    if (condition.operator === 'exists') return wanted.length > 0
    if (condition.operator === 'contains' && typeof condition.value === 'string') {
      return wanted.includes(condition.value.trim().toLowerCase())
    }
    if (condition.operator === 'in' && Array.isArray(condition.value)) {
      return condition.value.some(
        (item) => typeof item === 'string' && wanted.includes(item.trim().toLowerCase()),
      )
    }
    return false
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
    lead: ScoredLead,
    visitorData: { sessionCount: number; totalPageViews: number; pageUrls: string[] },
    facts: LeadScoringFacts,
  ) {
    const scores = { demographic: 0, behavior: 0, engagement: 0 }
    const breakdown: Record<string, number> = {}

    for (const rule of rules) {
      const condition = rule.condition as ScoringCondition
      if (condition && this.matchCondition(condition, lead, visitorData, facts)) {
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
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(value)
      default:
        return false
    }
  }
}

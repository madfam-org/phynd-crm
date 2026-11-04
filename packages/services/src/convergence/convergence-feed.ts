import type { Database } from '@phynd/db'
import {
  contacts,
  conversions,
  engagements,
  leads,
  opportunities,
  pipelineStages,
} from '@phynd/db/schema'
import {
  and,
  asc,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  notLike,
  or,
  sql,
} from 'drizzle-orm'
import {
  type ConvergenceLead,
  type ConvergenceOpportunity,
  type ConvergencePeriod,
  type FeedResult,
  collectFeed,
  isLeadInPeriod,
  isOpportunityInPeriod,
  toConvergenceLead,
  toConvergenceOpportunity,
} from './convergence-mapping'

export * from './convergence-mapping'

/** Source of the synthetic lead written by `POST /api/v1/probe/leads`. Never a real lead. */
export const SYNTHETIC_PROBE_LEAD_SOURCE = 'synthetic-probe'

/** Demo sessions write `demo-<session>` ids into the default database (demo-seed). */
const DEMO_ID_PATTERN = 'demo-%'

/**
 * Read side of the convergence API for one tenant database. Rows are
 * narrowed in SQL; the exact period rule and the field mapping live in
 * `convergence-mapping.ts`.
 */
export class ConvergenceFeedService {
  constructor(private readonly db: Database) {}

  async listLeads(period: ConvergencePeriod): Promise<FeedResult<ConvergenceLead>> {
    const rows = await this.db
      .select({
        id: leads.id,
        status: leads.status,
        contactId: leads.contactId,
        source: leads.source,
        score: leads.score,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .where(
        and(
          isNull(leads.deletedAt),
          notLike(leads.id, DEMO_ID_PATTERN),
          or(isNull(leads.source), ne(leads.source, SYNTHETIC_PROBE_LEAD_SOURCE)),
          gte(leads.createdAt, period.start),
          lt(leads.createdAt, period.end),
        ),
      )
      .orderBy(asc(leads.createdAt), asc(leads.id))

    const inPeriod = rows.filter((row) => isLeadInPeriod(row, period))
    const customers = await this.customerContactIds(inPeriod.map((row) => row.contactId))
    return collectFeed(inPeriod, (row) => toConvergenceLead(row, customers))
  }

  async listOpportunities(period: ConvergencePeriod): Promise<FeedResult<ConvergenceOpportunity>> {
    // At most one `opportunity_to_won` conversion per opportunity
    // (unique index conversions_type_opportunity_uniq), so the join adds no rows.
    const rows = await this.db
      .select({
        id: opportunities.id,
        status: opportunities.status,
        stageName: pipelineStages.name,
        stageProbability: pipelineStages.probability,
        value: opportunities.value,
        probability: opportunities.probability,
        contactId: opportunities.contactId,
        expectedCloseDate: opportunities.expectedCloseDate,
        createdAt: opportunities.createdAt,
        updatedAt: opportunities.updatedAt,
        wonAt: conversions.convertedAt,
      })
      .from(opportunities)
      .leftJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .leftJoin(
        conversions,
        and(
          eq(conversions.opportunityId, opportunities.id),
          eq(conversions.type, 'opportunity_to_won'),
        ),
      )
      .where(
        and(
          isNull(opportunities.deletedAt),
          notLike(opportunities.id, DEMO_ID_PATTERN),
          lt(opportunities.createdAt, period.end),
          // Superset of "still open, or closed at/after start"; the exact
          // rule is isOpportunityInPeriod below.
          or(
            notInArray(opportunities.status, ['won', 'lost']),
            gte(opportunities.updatedAt, period.start),
            gte(conversions.convertedAt, period.start),
          ),
        ),
      )
      .orderBy(asc(opportunities.createdAt), asc(opportunities.id))

    const inPeriod = rows.filter((row) => isOpportunityInPeriod(row, period))
    const customers = await this.customerContactIds(inPeriod.map((row) => row.contactId))
    return collectFeed(inPeriod, (row) => toConvergenceOpportunity(row, customers))
  }

  /**
   * Contacts that are MADFAM customers: not deleted, and with a won
   * opportunity or an engagement that is not cancelled. Only these become a
   * `customer_id`, because converge-dash counts every customer_id it sees as
   * an active customer.
   */
  async customerContactIds(contactIds: (string | null)[]): Promise<Set<string>> {
    const ids = [...new Set(contactIds.filter((id): id is string => Boolean(id)))]
    if (ids.length === 0) return new Set()

    const wonOpportunity = this.db
      .select({ one: sql`1` })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.contactId, contacts.id),
          eq(opportunities.status, 'won'),
          isNull(opportunities.deletedAt),
        ),
      )
    const liveEngagement = this.db
      .select({ one: sql`1` })
      .from(engagements)
      .where(
        and(
          eq(engagements.contactId, contacts.id),
          ne(engagements.status, 'cancelled'),
          isNull(engagements.deletedAt),
        ),
      )

    const rows = await this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          inArray(contacts.id, ids),
          isNull(contacts.deletedAt),
          or(exists(wonOpportunity), exists(liveEngagement)),
        ),
      )
    return new Set(rows.map((row) => row.id))
  }
}

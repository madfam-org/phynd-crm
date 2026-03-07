import { conversions } from '@phyne/db/schema'
import { eq, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class ConversionsService {
  constructor(private readonly ctx: ServiceContext) {}

  async recordConversion(data: {
    type: string
    contactId?: string
    leadId?: string
    opportunityId?: string
    campaignId?: string
    visitorSessionId?: string
    value?: string
    metadata?: Record<string, unknown>
  }) {
    const [conversion] = await this.ctx.db.insert(conversions).values(data).returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return conversion!
  }

  async getByEntity(entityType: 'contact' | 'lead' | 'opportunity', entityId: string) {
    const column =
      entityType === 'contact'
        ? conversions.contactId
        : entityType === 'lead'
          ? conversions.leadId
          : conversions.opportunityId
    return this.ctx.db
      .select()
      .from(conversions)
      .where(eq(column, entityId))
      .orderBy(conversions.convertedAt)
  }

  async getFunnelMetrics() {
    const [result] = await this.ctx.db
      .select({
        visitorToLead: sql<number>`count(*) filter (where ${conversions.type} = 'visitor_to_lead')::int`,
        leadToOpportunity: sql<number>`count(*) filter (where ${conversions.type} = 'lead_to_opportunity')::int`,
        opportunityToWon: sql<number>`count(*) filter (where ${conversions.type} = 'opportunity_to_won')::int`,
        offerRedemptions: sql<number>`count(*) filter (where ${conversions.type} = 'offer_redemption')::int`,
        totalValue: sql<number>`coalesce(sum(${conversions.value}::numeric), 0)::numeric`,
      })
      .from(conversions)

    return (
      result ?? {
        visitorToLead: 0,
        leadToOpportunity: 0,
        opportunityToWon: 0,
        offerRedemptions: 0,
        totalValue: 0,
      }
    )
  }
}

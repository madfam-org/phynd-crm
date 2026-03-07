import { campaigns, conversions, offers } from '@phyne/db/schema'
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
    const created = conversion!

    // Auto-redeem offer if conversion is linked to a campaign with an offer
    if (data.campaignId) {
      await this.autoRedeemOffer(data.campaignId)
    }

    return created
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

  private async autoRedeemOffer(campaignId: string) {
    try {
      const [campaign] = await this.ctx.db
        .select({ offerId: campaigns.offerId })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId))

      if (!campaign?.offerId) return

      // Check offer is active and has remaining redemptions
      const [offer] = await this.ctx.db.select().from(offers).where(eq(offers.id, campaign.offerId))

      if (!offer || offer.status !== 'active') return
      if (offer.maxRedemptions && offer.currentRedemptions >= offer.maxRedemptions) return

      // Increment redemption count
      await this.ctx.db
        .update(offers)
        .set({ currentRedemptions: sql`${offers.currentRedemptions} + 1` })
        .where(eq(offers.id, campaign.offerId))

      // Record the redemption as a conversion event
      await this.ctx.db.insert(conversions).values({
        type: 'offer_redemption',
        campaignId,
        metadata: { offerId: campaign.offerId, autoRedeemed: true },
      })
    } catch {
      // Non-blocking: redemption failure should not break conversion recording
    }
  }
}

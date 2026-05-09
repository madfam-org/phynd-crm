import { campaigns } from '@phynd/db/schema'
import type { PaginatedResult, PaginationInput } from '@phynd/types/crm'
import { and, eq, gt } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class CampaignsService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<typeof campaigns.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = []
    if (pagination?.cursor) {
      conditions.push(gt(campaigns.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(campaigns)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(campaigns.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async getById(id: string) {
    const [campaign] = await this.ctx.db.select().from(campaigns).where(eq(campaigns.id, id))
    return campaign ?? null
  }

  /**
   * Look up a campaign by its `utm_campaign` slug — used by inbound webhooks
   * (ceq, cotiza, tezca landing pages) that carry UTM params from a paid
   * marketing source. Caller is responsible for normalizing the slug
   * casing; this method does an exact match.
   *
   * Returns the first active campaign whose `utm_campaign` matches, or
   * null when no match is found. When multiple campaigns share the same
   * utm_campaign value (e.g. seasonal re-runs), the earliest by `createdAt`
   * wins to keep attribution stable across the campaign's lifetime.
   */
  async getByUtmCampaign(utmCampaign: string) {
    if (!utmCampaign) return null
    const [campaign] = await this.ctx.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.utmCampaign, utmCampaign))
      .orderBy(campaigns.createdAt)
      .limit(1)
    return campaign ?? null
  }

  async create(data: {
    name: string
    description?: string
    channel?: string
    status?: string
    utmSource?: string
    utmMedium?: string
    utmCampaign?: string
    budget?: string
    currency?: string
    startDate?: Date
    endDate?: Date
    offerId?: string
  }) {
    const [campaign] = await this.ctx.db.insert(campaigns).values(data).returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return campaign!
  }

  async update(
    id: string,
    data: Partial<{
      name: string
      description: string
      channel: string
      status: string
      utmSource: string
      utmMedium: string
      utmCampaign: string
      budget: string
      spend: string
      currency: string
      startDate: Date
      endDate: Date
      offerId: string
    }>,
  ) {
    const [campaign] = await this.ctx.db
      .update(campaigns)
      .set(data)
      .where(eq(campaigns.id, id))
      .returning()
    return campaign ?? null
  }

  async delete(id: string) {
    const [deleted] = await this.ctx.db.delete(campaigns).where(eq(campaigns.id, id)).returning()
    return deleted ?? null
  }
}

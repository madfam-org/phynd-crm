import { campaigns } from '@phyne/db/schema'
import { eq } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class CampaignsService {
  constructor(private readonly ctx: ServiceContext) {}

  async list() {
    return this.ctx.db.select().from(campaigns).orderBy(campaigns.createdAt)
  }

  async getById(id: string) {
    const [campaign] = await this.ctx.db.select().from(campaigns).where(eq(campaigns.id, id))
    return campaign ?? null
  }

  async create(data: {
    name: string
    description?: string
    channel?: string
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

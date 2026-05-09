import { offers } from '@phynd/db/schema'
import type { PaginatedResult, PaginationInput } from '@phynd/types/crm'
import { and, eq, gt, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class OffersService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(pagination?: PaginationInput): Promise<PaginatedResult<typeof offers.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = []
    if (pagination?.cursor) {
      conditions.push(gt(offers.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(offers)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(offers.id)
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
    const [offer] = await this.ctx.db.select().from(offers).where(eq(offers.id, id))
    return offer ?? null
  }

  async create(data: {
    name: string
    description?: string
    type?: string
    value?: string
    currency?: string
    validFrom?: Date
    validUntil?: Date
    maxRedemptions?: number
    externalProductId?: string
    externalProvider?: string
  }) {
    const [offer] = await this.ctx.db.insert(offers).values(data).returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return offer!
  }

  async update(
    id: string,
    data: Partial<{
      name: string
      description: string
      type: string
      value: string
      currency: string
      validFrom: Date
      validUntil: Date
      maxRedemptions: number
      status: string
      externalProductId: string
      externalProvider: string
    }>,
  ) {
    const [offer] = await this.ctx.db.update(offers).set(data).where(eq(offers.id, id)).returning()
    return offer ?? null
  }

  async recordRedemption(id: string) {
    const [offer] = await this.ctx.db
      .update(offers)
      .set({
        currentRedemptions: sql`${offers.currentRedemptions} + 1`,
      })
      .where(eq(offers.id, id))
      .returning()
    return offer ?? null
  }

  async delete(id: string) {
    const [deleted] = await this.ctx.db.delete(offers).where(eq(offers.id, id)).returning()
    return deleted ?? null
  }
}

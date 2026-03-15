import { quotes } from '@phyne/db/schema'
import type { PaginatedResult, PaginationInput } from '@phyne/types/crm'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { NotificationsService } from '../notifications/notifications.service'

export class QuotesService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(
    pagination?: PaginationInput,
    filters?: { ownerId?: string },
  ): Promise<PaginatedResult<typeof quotes.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [isNull(quotes.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(quotes.id, pagination.cursor))
    }
    if (filters?.ownerId) {
      conditions.push(eq(quotes.ownerId, filters.ownerId))
    }

    const rows = await this.ctx.db
      .select()
      .from(quotes)
      .where(and(...conditions))
      .orderBy(quotes.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async listByOpportunityId(
    opportunityId: string,
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<typeof quotes.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [eq(quotes.opportunityId, opportunityId), isNull(quotes.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(quotes.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(quotes)
      .where(and(...conditions))
      .orderBy(quotes.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async listByContactId(
    contactId: string,
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<typeof quotes.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [eq(quotes.contactId, contactId), isNull(quotes.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(quotes.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(quotes)
      .where(and(...conditions))
      .orderBy(quotes.id)
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
    const [quote] = await this.ctx.db
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, id), isNull(quotes.deletedAt)))
    return quote ?? null
  }

  async create(data: {
    quoteNumber: string
    opportunityId?: string
    contactId?: string
    totalAmount?: string
    currency?: string
    validUntil?: Date
    ownerId?: string
  }) {
    const [quote] = await this.ctx.db.insert(quotes).values(data).returning()
    return quote ?? null
  }

  async update(
    id: string,
    data: Partial<{
      quoteNumber: string
      totalAmount: string
      currency: string
      status: string
      validUntil: Date
      ownerId: string
    }>,
  ) {
    let previousOwnerId: string | null = null
    if (data.ownerId) {
      const existing = await this.getById(id)
      previousOwnerId = existing?.ownerId ?? null
    }

    const [quote] = await this.ctx.db.update(quotes).set(data).where(eq(quotes.id, id)).returning()

    if (quote && data.ownerId && data.ownerId !== previousOwnerId) {
      try {
        const notificationsService = new NotificationsService(this.ctx)
        await notificationsService.create({
          userId: data.ownerId,
          type: 'owner_assignment',
          title: 'New quote assigned to you',
          message: `You have been assigned quote: ${quote.quoteNumber}`,
          entityType: 'quote',
          entityId: id,
        })
      } catch {
        // Non-blocking: notification failure should not break quote operations
      }
    }

    return quote ?? null
  }

  async delete(id: string) {
    const [deleted] = await this.ctx.db
      .update(quotes)
      .set({ deletedAt: new Date() })
      .where(eq(quotes.id, id))
      .returning()
    return deleted ?? null
  }
}

import { conversions, opportunities, orders } from '@phynd/db/schema'
import type { PaginatedResult, PaginationInput } from '@phynd/types/crm'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { NotificationsService } from '../notifications/notifications.service'

export class OrdersService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(
    pagination?: PaginationInput,
    filters?: { ownerId?: string },
  ): Promise<PaginatedResult<typeof orders.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [isNull(orders.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(orders.id, pagination.cursor))
    }
    if (filters?.ownerId) {
      conditions.push(eq(orders.ownerId, filters.ownerId))
    }

    const rows = await this.ctx.db
      .select()
      .from(orders)
      .where(and(...conditions))
      .orderBy(orders.id)
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
  ): Promise<PaginatedResult<typeof orders.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [eq(orders.opportunityId, opportunityId), isNull(orders.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(orders.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(orders)
      .where(and(...conditions))
      .orderBy(orders.id)
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
  ): Promise<PaginatedResult<typeof orders.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [eq(orders.contactId, contactId), isNull(orders.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(orders.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(orders)
      .where(and(...conditions))
      .orderBy(orders.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async listByQuoteId(
    quoteId: string,
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<typeof orders.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [eq(orders.quoteId, quoteId), isNull(orders.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(orders.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(orders)
      .where(and(...conditions))
      .orderBy(orders.id)
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
    const [order] = await this.ctx.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
    return order ?? null
  }

  async create(data: {
    orderNumber: string
    opportunityId?: string
    quoteId?: string
    contactId?: string
    totalAmount?: string
    currency?: string
    estimatedCompletion?: Date
    ownerId?: string
  }) {
    const [order] = await this.ctx.db.insert(orders).values(data).returning()
    return order ?? null
  }

  async update(
    id: string,
    data: Partial<{
      orderNumber: string
      totalAmount: string
      currency: string
      status: string
      estimatedCompletion: Date
      actualCompletion: Date
      ownerId: string
    }>,
  ) {
    let previousOwnerId: string | null = null
    if (data.ownerId) {
      const existing = await this.getById(id)
      previousOwnerId = existing?.ownerId ?? null
    }

    const [order] = await this.ctx.db.update(orders).set(data).where(eq(orders.id, id)).returning()

    if (!order) return null

    // When order fulfilled and linked to an opportunity, auto-mark opportunity as won
    if (data.status === 'fulfilled' && order.opportunityId) {
      const oppId = order.opportunityId
      try {
        await this.ctx.db.transaction(async (tx) => {
          const [opp] = await tx.select().from(opportunities).where(eq(opportunities.id, oppId))

          if (opp && opp.status !== 'won') {
            await tx.update(opportunities).set({ status: 'won' }).where(eq(opportunities.id, oppId))

            await tx.insert(conversions).values({
              type: 'opportunity_to_won',
              contactId: order.contactId,
              opportunityId: oppId,
              value: opp.value,
            })
          }
        })
      } catch {
        // Non-blocking: fulfillment auto-close should not break order update
      }
    }

    // Notify new owner on assignment
    if (data.ownerId && data.ownerId !== previousOwnerId) {
      try {
        const notificationsService = new NotificationsService(this.ctx)
        await notificationsService.create({
          userId: data.ownerId,
          type: 'owner_assignment',
          title: 'New order assigned to you',
          message: `You have been assigned order: ${order.orderNumber}`,
          entityType: 'order',
          entityId: id,
        })
      } catch {
        // Non-blocking
      }
    }

    return order
  }

  async delete(id: string) {
    const [deleted] = await this.ctx.db
      .update(orders)
      .set({ deletedAt: new Date() })
      .where(eq(orders.id, id))
      .returning()
    return deleted ?? null
  }
}

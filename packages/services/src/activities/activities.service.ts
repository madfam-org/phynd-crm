import { activities } from '@phyne/db/schema'
import type { EntityType, PaginatedResult, PaginationInput } from '@phyne/types/crm'
import { and, desc, eq, gt } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class ActivitiesService {
  constructor(private readonly ctx: ServiceContext) {}

  async listForEntity(entityType: EntityType, entityId: string) {
    return this.ctx.db
      .select()
      .from(activities)
      .where(and(eq(activities.entityType, entityType), eq(activities.entityId, entityId)))
      .orderBy(activities.createdAt)
  }

  async create(data: {
    type: string
    title: string
    description?: string
    dueAt?: Date
    entityType: EntityType
    entityId: string
  }) {
    const [activity] = await this.ctx.db
      .insert(activities)
      .values({
        ...data,
        ownerId: this.ctx.auth.userId,
      })
      .returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return activity!
  }

  async listRecent(
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<typeof activities.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = []
    if (pagination?.cursor) {
      conditions.push(gt(activities.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(activities)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(activities.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async update(
    id: string,
    data: { title?: string; description?: string | null; dueAt?: Date | null },
  ) {
    const [activity] = await this.ctx.db
      .update(activities)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(activities.id, id))
      .returning()
    return activity ?? null
  }

  async delete(id: string) {
    const [activity] = await this.ctx.db.delete(activities).where(eq(activities.id, id)).returning()
    return activity ?? null
  }

  async complete(id: string) {
    const [activity] = await this.ctx.db
      .update(activities)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(activities.id, id))
      .returning()
    return activity ?? null
  }
}

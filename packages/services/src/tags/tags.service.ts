import { taggables, tags } from '@phynd/db/schema'
import type { EntityType, PaginatedResult, PaginationInput } from '@phynd/types/crm'
import { and, eq, gt } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class TagsService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(pagination?: PaginationInput): Promise<PaginatedResult<typeof tags.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = []
    if (pagination?.cursor) {
      conditions.push(gt(tags.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(tags)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(tags.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async create(data: { name: string; color?: string }) {
    const [tag] = await this.ctx.db.insert(tags).values(data).returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return tag!
  }

  async delete(id: string) {
    const [tag] = await this.ctx.db.delete(tags).where(eq(tags.id, id)).returning()
    return tag ?? null
  }

  async addToEntity(tagId: string, entityType: EntityType, entityId: string) {
    const [taggable] = await this.ctx.db
      .insert(taggables)
      .values({ tagId, entityType, entityId })
      .onConflictDoNothing()
      .returning()
    return taggable ?? null
  }

  async removeFromEntity(tagId: string, entityType: EntityType, entityId: string) {
    const [taggable] = await this.ctx.db
      .delete(taggables)
      .where(
        and(
          eq(taggables.tagId, tagId),
          eq(taggables.entityType, entityType),
          eq(taggables.entityId, entityId),
        ),
      )
      .returning()
    return taggable ?? null
  }

  async getForEntity(entityType: EntityType, entityId: string) {
    return this.ctx.db
      .select({ id: tags.id, name: tags.name, color: tags.color, createdAt: tags.createdAt })
      .from(taggables)
      .innerJoin(tags, eq(taggables.tagId, tags.id))
      .where(and(eq(taggables.entityType, entityType), eq(taggables.entityId, entityId)))
  }
}

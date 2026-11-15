import { activities, contacts, leads, opportunities, orders, quotes } from '@phynd/db/schema'
import type { EntityType, PaginatedResult, PaginationInput } from '@phynd/types/crm'
import { type SQL, and, desc, eq, gte, isNotNull, lt, notExists, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { requireCrmUserId } from '../identity/actor'

export interface ActivityListFilters {
  ownerId?: string
  /** `pending`, `completed` or `cancelled`. */
  status?: string
  /** `call`, `email`, `meeting`, `task`, … */
  type?: string
  /** Due at or after this instant (activities without a due date never match). */
  dueFrom?: Date
  /** Due strictly before this instant (activities without a due date never match). */
  dueBefore?: Date
  /**
   * Leave out activities whose parent record (`entity_type` + `entity_id`) is
   * soft-deleted. Off by default: the staff Activities page lists them.
   */
  excludeDeletedParents?: boolean
}

/**
 * Every record an activity can hang off (`EntityType`); each has `deleted_at`.
 * Built on use, not at module load, so a test that mocks part of the schema
 * can still load this module.
 */
function parentTables() {
  return [
    ['contact', contacts],
    ['lead', leads],
    ['opportunity', opportunities],
    ['order', orders],
    ['quote', quotes],
  ] as const satisfies ReadonlyArray<readonly [EntityType, unknown]>
}

export class ActivitiesService {
  constructor(private readonly ctx: ServiceContext) {}

  /** The newest `limit` activities of one record, newest first. */
  async listRecentForEntity(entityType: EntityType, entityId: string, limit = 20) {
    return this.ctx.db
      .select()
      .from(activities)
      .where(and(eq(activities.entityType, entityType), eq(activities.entityId, entityId)))
      .orderBy(desc(activities.createdAt), desc(activities.id))
      .limit(limit)
  }

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
    /**
     * Owner of the activity. Omitted: the caller (the usual case). `null`: no
     * owner yet, for items a machine caller opens for whoever picks them up.
     */
    ownerId?: string | null
  }) {
    const ownerId = data.ownerId !== undefined ? data.ownerId : requireCrmUserId(this.ctx.auth)
    const [activity] = await this.ctx.db
      .insert(activities)
      .values({
        ...data,
        ownerId,
      })
      .returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return activity!
  }

  /** One `NOT EXISTS` per parent table: no soft-deleted parent of that type matches. */
  private withoutDeletedParents(): SQL[] {
    return parentTables().map(([entityType, parent]) =>
      notExists(
        this.ctx.db
          .select({ one: sql`1` })
          .from(parent)
          .where(
            and(
              eq(activities.entityType, entityType),
              eq(parent.id, activities.entityId),
              isNotNull(parent.deletedAt),
            ),
          ),
      ),
    )
  }

  async listRecent(
    pagination?: PaginationInput,
    filters?: ActivityListFilters,
  ): Promise<PaginatedResult<typeof activities.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = []
    if (pagination?.cursor) {
      // Newest first. The cursor is the last id of the previous page; rows
      // after it are older, with the id breaking ties on the same instant.
      conditions.push(
        sql`(${activities.createdAt}, ${activities.id}) < (select c.created_at, c.id from activities c where c.id = ${pagination.cursor})`,
      )
    }
    if (filters?.ownerId) {
      conditions.push(eq(activities.ownerId, filters.ownerId))
    }
    if (filters?.status) {
      conditions.push(eq(activities.status, filters.status))
    }
    if (filters?.type) {
      conditions.push(eq(activities.type, filters.type))
    }
    if (filters?.dueFrom) {
      conditions.push(gte(activities.dueAt, filters.dueFrom))
    }
    if (filters?.dueBefore) {
      conditions.push(lt(activities.dueAt, filters.dueBefore))
    }
    if (filters?.excludeDeletedParents) {
      conditions.push(...this.withoutDeletedParents())
    }

    const rows = await this.ctx.db
      .select()
      .from(activities)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(activities.createdAt), desc(activities.id))
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
    data: {
      title?: string
      description?: string | null
      dueAt?: Date | null
      /** Assigns the activity, e.g. someone claiming an unowned follow-up. */
      ownerId?: string
    },
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

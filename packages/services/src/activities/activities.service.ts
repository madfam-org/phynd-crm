import { activities } from '@phyne/db/schema'
import type { EntityType } from '@phyne/types/crm'
import { and, desc, eq } from 'drizzle-orm'
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

  async listRecent(limit = 50) {
    return this.ctx.db.select().from(activities).orderBy(desc(activities.createdAt)).limit(limit)
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

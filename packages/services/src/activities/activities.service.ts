import { and, eq } from 'drizzle-orm'
import { activities } from '@phyne/db/schema'
import type { EntityType } from '@phyne/types/crm'
import type { ServiceContext } from '../context'

export class ActivitiesService {
  constructor(private readonly ctx: ServiceContext) {}

  async listForEntity(entityType: EntityType, entityId: string) {
    return this.ctx.db
      .select()
      .from(activities)
      .where(and(
        eq(activities.entityType, entityType),
        eq(activities.entityId, entityId),
      ))
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
    return activity!
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

import { conversions, opportunities, stageTransitions } from '@phyne/db/schema'
import type { PaginatedResult, PaginationInput } from '@phyne/types/crm'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { NotificationsService } from '../notifications/notifications.service'

export class OpportunitiesService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(
    pagination?: PaginationInput,
    filters?: { ownerId?: string },
  ): Promise<PaginatedResult<typeof opportunities.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [isNull(opportunities.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(opportunities.id, pagination.cursor))
    }
    if (filters?.ownerId) {
      conditions.push(eq(opportunities.ownerId, filters.ownerId))
    }

    const rows = await this.ctx.db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(opportunities.id)
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
  ): Promise<PaginatedResult<typeof opportunities.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [eq(opportunities.contactId, contactId), isNull(opportunities.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(opportunities.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(opportunities.id)
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
    const [opp] = await this.ctx.db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
    return opp ?? null
  }

  async create(data: {
    name: string
    contactId?: string
    pipelineId: string
    stageId: string
    value?: string
    probability?: number
    expectedCloseDate?: Date
  }) {
    const created = await this.ctx.db.transaction(async (tx) => {
      const [opp] = await tx.insert(opportunities).values(data).returning()
      // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
      const newOpp = opp!

      // Auto-record lead_to_opportunity conversion
      await tx.insert(conversions).values({
        type: 'lead_to_opportunity',
        contactId: data.contactId,
        opportunityId: newOpp.id,
        value: data.value,
      })

      return newOpp
    })

    return created
  }

  async update(
    id: string,
    data: Partial<{
      name: string
      stageId: string
      value: string
      probability: number
      status: string
      expectedCloseDate: Date
      ownerId: string
    }>,
  ) {
    // Check if owner is changing for notification
    let previousOwnerId: string | null = null
    if (data.ownerId) {
      const existing = await this.getById(id)
      previousOwnerId = existing?.ownerId ?? null
    }

    // When marking as won, wrap update + conversion in a transaction
    if (data.status === 'won') {
      const current = await this.getById(id)
      if (current && current.status !== 'won') {
        const [opp] = await this.ctx.db.transaction(async (tx) => {
          const [updated] = await tx
            .update(opportunities)
            .set(data)
            .where(eq(opportunities.id, id))
            .returning()

          await tx.insert(conversions).values({
            type: 'opportunity_to_won',
            contactId: current.contactId,
            opportunityId: id,
            value: data.value ?? current.value,
          })

          return [updated]
        })

        if (opp && data.ownerId && data.ownerId !== previousOwnerId) {
          await this.notifyOwnerAssignment(data.ownerId, 'opportunity', id, opp.name)
        }

        return opp ?? null
      }
    }

    const [opp] = await this.ctx.db
      .update(opportunities)
      .set(data)
      .where(eq(opportunities.id, id))
      .returning()

    // Notify new owner on assignment
    if (opp && data.ownerId && data.ownerId !== previousOwnerId) {
      await this.notifyOwnerAssignment(data.ownerId, 'opportunity', id, opp.name)
    }

    return opp ?? null
  }

  async moveToStage(id: string, stageId: string) {
    const current = await this.getById(id)
    const result = await this.update(id, { stageId })

    // Record stage transition
    if (result) {
      await this.ctx.db.insert(stageTransitions).values({
        entityType: 'opportunity',
        entityId: id,
        fromStageId: current?.stageId ?? null,
        toStageId: stageId,
        transitionedBy: this.ctx.auth.userId || null,
      })
    }

    return result
  }

  async bulkUpdateStatus(ids: string[], status: string) {
    const results = await this.ctx.db.transaction(async (tx) => {
      const updated = []
      for (const id of ids) {
        const [opp] = await tx
          .update(opportunities)
          .set({ status })
          .where(eq(opportunities.id, id))
          .returning()
        if (opp) updated.push(opp)
      }
      return updated
    })
    return results
  }

  private async notifyOwnerAssignment(
    userId: string,
    entityType: string,
    entityId: string,
    entityName: string,
  ) {
    try {
      const notificationsService = new NotificationsService(this.ctx)
      await notificationsService.create({
        userId,
        type: 'owner_assignment',
        title: `New ${entityType} assigned to you`,
        message: `You have been assigned ${entityType}: ${entityName}`,
        entityType,
        entityId,
      })
    } catch {
      // Non-blocking: notification failure should not break opportunity operations
    }
  }

  async delete(id: string) {
    const [deleted] = await this.ctx.db
      .update(opportunities)
      .set({ deletedAt: new Date() })
      .where(eq(opportunities.id, id))
      .returning()
    return deleted ?? null
  }
}

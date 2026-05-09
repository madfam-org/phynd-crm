import { isFeatureEnabled } from '@phynd/config/features'
import { conversions, leads, stageTransitions } from '@phynd/db/schema'
import type { PaginatedResult, PaginationInput } from '@phynd/types/crm'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { LeadScoringService } from '../lead-scoring/lead-scoring.service'
import { NotificationsService } from '../notifications/notifications.service'

export class LeadsService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(
    pagination?: PaginationInput,
    filters?: { ownerId?: string },
  ): Promise<PaginatedResult<typeof leads.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [isNull(leads.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(leads.id, pagination.cursor))
    }
    if (filters?.ownerId) {
      conditions.push(eq(leads.ownerId, filters.ownerId))
    }

    const rows = await this.ctx.db
      .select()
      .from(leads)
      .where(and(...conditions))
      .orderBy(leads.id)
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
  ): Promise<PaginatedResult<typeof leads.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [eq(leads.contactId, contactId), isNull(leads.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(leads.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(leads)
      .where(and(...conditions))
      .orderBy(leads.id)
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
    const [lead] = await this.ctx.db
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
    return lead ?? null
  }

  async create(data: {
    contactId?: string
    externalJanuaId?: string
    source?: string
    pipelineId: string
    stageId: string
  }) {
    const created = await this.ctx.db.transaction(async (tx) => {
      const [lead] = await tx.insert(leads).values(data).returning()
      // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
      const newLead = lead!

      // Auto-record visitor_to_lead conversion
      await tx.insert(conversions).values({
        type: 'visitor_to_lead',
        contactId: data.contactId,
        leadId: newLead.id,
      })

      return newLead
    })

    // Auto-compute lead score on creation (outside transaction, non-blocking)
    await this.triggerScoring(created.id)

    return created
  }

  async update(
    id: string,
    data: Partial<{
      status: string
      score: number
      stageId: string
      ownerId: string
    }>,
  ) {
    // Check if owner is changing for notification
    let previousOwnerId: string | null = null
    if (data.ownerId) {
      const current = await this.getById(id)
      previousOwnerId = current?.ownerId ?? null
    }

    const [lead] = await this.ctx.db.update(leads).set(data).where(eq(leads.id, id)).returning()

    // Auto-recompute lead score on status change
    if (lead && data.status) {
      await this.triggerScoring(id)
    }

    // Notify new owner on assignment
    if (lead && data.ownerId && data.ownerId !== previousOwnerId) {
      await this.notifyOwnerAssignment(data.ownerId, 'lead', id, lead.source ?? 'Lead')
    }

    return lead ?? null
  }

  async moveToStage(id: string, stageId: string) {
    const current = await this.getById(id)
    const result = await this.update(id, { stageId })

    // Record stage transition
    if (result) {
      await this.ctx.db.insert(stageTransitions).values({
        entityType: 'lead',
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
        const [lead] = await tx.update(leads).set({ status }).where(eq(leads.id, id)).returning()
        if (lead) updated.push(lead)
      }
      return updated
    })
    return results
  }

  async delete(id: string) {
    const [deleted] = await this.ctx.db
      .update(leads)
      .set({ deletedAt: new Date() })
      .where(eq(leads.id, id))
      .returning()
    return deleted ?? null
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
      // Non-blocking: notification failure should not break lead operations
    }
  }

  private async triggerScoring(leadId: string) {
    if (!isFeatureEnabled('leadScoring')) return
    try {
      const scoringService = new LeadScoringService(this.ctx)
      await scoringService.computeScore(leadId)
    } catch {
      // Non-blocking: scoring failure should not break lead operations
    }
  }
}

import { isFeatureEnabled } from '@phynd/config/features'
import { activities, conversions, leads, stageTransitions, users } from '@phynd/db/schema'
import type { LeadAttribution, LeadTier, PaginatedResult, PaginationInput } from '@phynd/types/crm'
import { and, asc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm'
import { type ServiceContext, withTransaction } from '../context'
import { NotFoundError, ValidationError } from '../errors'
import { actorIdOf } from '../identity/actor'
import { LeadScoringService } from '../lead-scoring/lead-scoring.service'
import { NotificationsService } from '../notifications/notifications.service'
import { sanitizeLeadAttribution } from './lead-attribution'
import { FIRST_CONTACT_TASK_KIND } from './lead-intake-defaults'
import { tierForScore } from './lead-qualification'

export interface LeadListFilters {
  ownerId?: string
  /** Only leads with no owner (ignored when `ownerId` is set). */
  unassigned?: boolean
  status?: string
  /** Exact match on the lead's source (`web`, `tezca`, …). */
  source?: string
  tier?: LeadTier
  /** Include synthetic/test leads (left out by default). */
  includeTest?: boolean
}

/**
 * Roles of the CRM users a lead can be assigned to: staff who work leads. A
 * viewer is read-only, so it is not offered.
 */
export const LEAD_ASSIGNABLE_ROLES = ['admin', 'manager', 'sales_rep'] as const

export interface LeadAssignee {
  id: string
  name: string | null
  email: string
  role: string
}

export class LeadsService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(
    pagination?: PaginationInput,
    filters?: LeadListFilters,
  ): Promise<PaginatedResult<typeof leads.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [isNull(leads.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(leads.id, pagination.cursor))
    }
    if (filters?.ownerId) {
      conditions.push(eq(leads.ownerId, filters.ownerId))
    } else if (filters?.unassigned) {
      conditions.push(isNull(leads.ownerId))
    }
    if (filters?.tier) {
      conditions.push(eq(leads.tier, filters.tier))
    }
    if (!filters?.includeTest) {
      conditions.push(eq(leads.isTest, false))
    }
    if (filters?.status) {
      conditions.push(eq(leads.status, filters.status))
    }
    if (filters?.source) {
      conditions.push(eq(leads.source, filters.source))
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
    attribution?: LeadAttribution | null
    pipelineId: string
    stageId: string
    /** Synthetic/test traffic (intake sets it by rule). */
    isTest?: boolean
    ownerId?: string | null
  }) {
    // Whatever the caller passes, only the known attribution shape is stored.
    const { attribution, ...fields } = data
    const values =
      attribution === undefined
        ? fields
        : { ...fields, attribution: sanitizeLeadAttribution(attribution) }

    const created = await this.ctx.db.transaction(async (tx) => {
      const [lead] = await tx.insert(leads).values(values).returning()
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

    // A score set by hand moves the tier with it (a waitlist lead stays C).
    let values: typeof data & { tier?: LeadTier | null } = data
    if (data.score !== undefined) {
      const current = await this.getById(id)
      const intent = (current?.attribution as LeadAttribution | null | undefined)?.intent
      values = { ...data, tier: tierForScore(data.score, intent) }
    }

    const [lead] = await this.ctx.db.update(leads).set(values).where(eq(leads.id, id)).returning()

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
        transitionedBy: actorIdOf(this.ctx.auth) || null,
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

  /**
   * CRM users a lead can be assigned to: a staff role that works leads and a
   * linked Janua account (so they can sign in). Ordered by name, then email.
   */
  async listAssignees(): Promise<LeadAssignee[]> {
    return this.ctx.db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(and(inArray(users.role, [...LEAD_ASSIGNABLE_ROLES]), isNotNull(users.externalJanuaId)))
      .orderBy(asc(users.name), asc(users.email))
  }

  /**
   * Reassigns a lead. The new owner must be an assignee (`listAssignees`). In
   * one transaction: the lead's owner, its open "First contact" task (moved to
   * the new owner) and a completed timeline entry recording the change. The new
   * owner then gets an in-app notification (best effort). Assigning the current
   * owner again changes nothing.
   */
  async assign(id: string, ownerId: string) {
    const lead = await this.getById(id)
    if (!lead) throw new NotFoundError('Lead', id)

    const [owner] = await this.ctx.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(
        and(
          eq(users.id, ownerId),
          inArray(users.role, [...LEAD_ASSIGNABLE_ROLES]),
          isNotNull(users.externalJanuaId),
        ),
      )
      .limit(1)
    if (!owner) {
      throw new ValidationError('That user cannot be assigned leads', { ownerId })
    }
    if (lead.ownerId === owner.id) return lead

    let previousLabel = 'unassigned'
    if (lead.ownerId) {
      const [previous] = await this.ctx.db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, lead.ownerId))
        .limit(1)
      previousLabel = previous ? (previous.name ?? previous.email) : 'a former user'
    }
    const ownerLabel = owner.name ?? owner.email
    const actorUserId = this.ctx.auth.crmUserId ?? null

    const updated = await this.ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .update(leads)
        .set({ ownerId: owner.id })
        .where(eq(leads.id, id))
        .returning()
      await tx
        .update(activities)
        .set({ ownerId: owner.id })
        .where(
          and(
            eq(activities.entityType, 'lead'),
            eq(activities.entityId, id),
            eq(activities.kind, FIRST_CONTACT_TASK_KIND),
            eq(activities.status, 'pending'),
          ),
        )
      await tx.insert(activities).values({
        type: 'note',
        title: `Lead assigned to ${ownerLabel}`.slice(0, 255),
        description: `Previous owner: ${previousLabel}.`,
        status: 'completed',
        completedAt: new Date(),
        entityType: 'lead',
        entityId: id,
        ownerId: actorUserId,
      })
      return row ?? null
    })

    if (updated && owner.id !== actorUserId) {
      await this.notifyOwnerAssignment(owner.id, 'lead', id, updated.source ?? 'Lead')
    }
    return updated
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
      // In its own (sub)transaction: when this service runs on a caller's
      // transaction, a failed scoring query rolls back to this savepoint
      // instead of aborting the caller's transaction.
      await this.ctx.db.transaction((tx) =>
        new LeadScoringService(withTransaction(this.ctx, tx)).computeScore(leadId),
      )
    } catch {
      // Non-blocking: scoring failure should not break lead operations
    }
  }
}

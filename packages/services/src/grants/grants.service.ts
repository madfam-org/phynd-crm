import { grantApplications, grantOpportunities, grantSignalAudit } from '@phynd/db/schema'
import type { PaginatedResult, PaginationInput } from '@phynd/types/crm'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { NotFoundError, ValidationError } from '../errors'

export interface ComplianceChecks {
  rfc_active?: boolean
  opinion_32d_positive?: boolean
  blacklisted?: boolean
}

export class GrantsService {
  constructor(private readonly ctx: ServiceContext) {}

  async listOpportunities(
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<typeof grantOpportunities.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = []
    if (pagination?.cursor) {
      conditions.push(gt(grantOpportunities.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(grantOpportunities)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(grantOpportunities.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async getOpportunity(id: string) {
    const [row] = await this.ctx.db
      .select()
      .from(grantOpportunities)
      .where(eq(grantOpportunities.id, id))
    if (!row) throw new NotFoundError('GrantOpportunity', id)
    return row
  }

  async upsertOpportunity(data: {
    fortunaGrantId: string
    title: string
    grantingBody?: string
    category?: string
    fundingType?: string
    minAmount?: string
    maxAmount?: string
    currency?: string
    sourceUrl?: string
    closesAt?: Date
    relevanceScore?: string
    requirementsSummary?: string
    metadata?: Record<string, unknown>
  }) {
    const [existing] = await this.ctx.db
      .select()
      .from(grantOpportunities)
      .where(eq(grantOpportunities.fortunaGrantId, data.fortunaGrantId))

    if (existing) {
      const [updated] = await this.ctx.db
        .update(grantOpportunities)
        .set({
          title: data.title,
          grantingBody: data.grantingBody,
          category: data.category,
          fundingType: data.fundingType,
          minAmount: data.minAmount,
          maxAmount: data.maxAmount,
          currency: data.currency ?? 'MXN',
          sourceUrl: data.sourceUrl,
          closesAt: data.closesAt,
          relevanceScore: data.relevanceScore,
          requirementsSummary: data.requirementsSummary,
          metadata: data.metadata,
        })
        .where(eq(grantOpportunities.id, existing.id))
        .returning()
      return updated ?? existing
    }

    const [created] = await this.ctx.db
      .insert(grantOpportunities)
      .values({
        fortunaGrantId: data.fortunaGrantId,
        title: data.title,
        grantingBody: data.grantingBody,
        category: data.category,
        fundingType: data.fundingType,
        minAmount: data.minAmount,
        maxAmount: data.maxAmount,
        currency: data.currency ?? 'MXN',
        sourceUrl: data.sourceUrl,
        closesAt: data.closesAt,
        relevanceScore: data.relevanceScore,
        requirementsSummary: data.requirementsSummary,
        metadata: data.metadata,
      })
      .returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return created!
  }

  async listApplications(
    pagination?: PaginationInput,
    filters?: { status?: string; ownerId?: string },
  ): Promise<PaginatedResult<typeof grantApplications.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [isNull(grantApplications.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(grantApplications.id, pagination.cursor))
    }
    if (filters?.status) {
      conditions.push(eq(grantApplications.status, filters.status))
    }
    if (filters?.ownerId) {
      conditions.push(eq(grantApplications.ownerId, filters.ownerId))
    }

    const rows = await this.ctx.db
      .select()
      .from(grantApplications)
      .where(and(...conditions))
      .orderBy(grantApplications.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async getApplication(id: string) {
    const [row] = await this.ctx.db
      .select()
      .from(grantApplications)
      .where(and(eq(grantApplications.id, id), isNull(grantApplications.deletedAt)))
    if (!row) throw new NotFoundError('GrantApplication', id)
    return row
  }

  async createApplication(data: {
    grantOpportunityId: string
    pipelineId: string
    stageId: string
    contactId?: string
    requestedAmount?: string
    ownerId?: string
  }) {
    const [app] = await this.ctx.db
      .insert(grantApplications)
      .values({
        grantOpportunityId: data.grantOpportunityId,
        pipelineId: data.pipelineId,
        stageId: data.stageId,
        contactId: data.contactId,
        requestedAmount: data.requestedAmount,
        ownerId: data.ownerId,
        status: 'draft',
      })
      .returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    const newApp = app!

    await this.recordAudit({
      grantOpportunityId: data.grantOpportunityId,
      grantApplicationId: newApp.id,
      eventType: 'discovered',
      actor: this.ctx.auth.userId,
    })

    return newApp
  }

  async moveToStage(id: string, stageId: string) {
    const current = await this.getApplication(id)

    const [updated] = await this.ctx.db
      .update(grantApplications)
      .set({ stageId })
      .where(eq(grantApplications.id, id))
      .returning()

    if (updated) {
      await this.recordAudit({
        grantOpportunityId: current.grantOpportunityId,
        grantApplicationId: id,
        eventType: 'discovered',
        actor: this.ctx.auth.userId,
        details: { fromStageId: current.stageId, toStageId: stageId },
      })
    }

    return updated ?? null
  }

  async requestHitlApproval(id: string) {
    const current = await this.getApplication(id)

    const [updated] = await this.ctx.db
      .update(grantApplications)
      .set({ status: 'hitl_pending' })
      .where(eq(grantApplications.id, id))
      .returning()

    if (updated) {
      await this.recordAudit({
        grantOpportunityId: current.grantOpportunityId,
        grantApplicationId: id,
        eventType: 'hitl_requested',
        actor: this.ctx.auth.userId,
      })
    }

    return updated ?? null
  }

  async approveForSubmission(id: string, userId: string, notes?: string) {
    if (!userId) {
      throw new ValidationError('HITL approval requires a real userId')
    }

    const current = await this.getApplication(id)
    const checks = current.complianceChecks as ComplianceChecks

    if (!checks.rfc_active) {
      throw new ValidationError('Compliance check failed: RFC is not active')
    }
    if (!checks.opinion_32d_positive) {
      throw new ValidationError('Compliance check failed: 32-D opinion is not positive')
    }
    if (checks.blacklisted) {
      throw new ValidationError('Compliance check failed: entity is blacklisted')
    }

    const [updated] = await this.ctx.db
      .update(grantApplications)
      .set({
        status: 'approved_to_submit',
        hitlApprovedBy: userId,
        hitlApprovedAt: new Date(),
        hitlNotes: notes ?? null,
      })
      .where(eq(grantApplications.id, id))
      .returning()

    if (updated) {
      await this.recordAudit({
        grantOpportunityId: current.grantOpportunityId,
        grantApplicationId: id,
        eventType: 'hitl_approved',
        actor: userId,
        details: { notes },
      })
    }

    return updated ?? null
  }

  async rejectSubmission(id: string, userId: string, notes?: string) {
    const current = await this.getApplication(id)

    const [updated] = await this.ctx.db
      .update(grantApplications)
      .set({
        status: 'rejected',
        hitlNotes: notes ?? null,
      })
      .where(eq(grantApplications.id, id))
      .returning()

    if (updated) {
      await this.recordAudit({
        grantOpportunityId: current.grantOpportunityId,
        grantApplicationId: id,
        eventType: 'hitl_rejected',
        actor: userId,
        details: { notes },
      })
    }

    return updated ?? null
  }

  async markSubmitted(id: string) {
    const current = await this.getApplication(id)

    const [updated] = await this.ctx.db
      .update(grantApplications)
      .set({
        status: 'submitted',
        submittedAt: new Date(),
      })
      .where(eq(grantApplications.id, id))
      .returning()

    if (updated) {
      await this.recordAudit({
        grantOpportunityId: current.grantOpportunityId,
        grantApplicationId: id,
        eventType: 'submitted',
        actor: this.ctx.auth.userId,
      })
    }

    return updated ?? null
  }

  async markAwarded(id: string, awardedAmount?: string) {
    const current = await this.getApplication(id)

    const setData: Record<string, unknown> = { status: 'awarded' }
    if (awardedAmount !== undefined) {
      setData.awardedAmount = awardedAmount
    }

    const [updated] = await this.ctx.db
      .update(grantApplications)
      .set(setData)
      .where(eq(grantApplications.id, id))
      .returning()

    if (updated) {
      await this.recordAudit({
        grantOpportunityId: current.grantOpportunityId,
        grantApplicationId: id,
        eventType: 'awarded',
        actor: this.ctx.auth.userId,
        details: { awardedAmount },
      })
    }

    return updated ?? null
  }

  async updateComplianceChecks(id: string, checks: ComplianceChecks) {
    const current = await this.getApplication(id)

    const [updated] = await this.ctx.db
      .update(grantApplications)
      .set({ complianceChecks: checks })
      .where(eq(grantApplications.id, id))
      .returning()

    if (updated) {
      await this.recordAudit({
        grantOpportunityId: current.grantOpportunityId,
        grantApplicationId: id,
        eventType: 'compliance_check',
        actor: 'system',
        details: { checks },
      })
    }

    return updated ?? null
  }

  async getAuditTrail(opportunityId?: string, applicationId?: string) {
    const conditions = []
    if (opportunityId) {
      conditions.push(eq(grantSignalAudit.grantOpportunityId, opportunityId))
    }
    if (applicationId) {
      conditions.push(eq(grantSignalAudit.grantApplicationId, applicationId))
    }

    return this.ctx.db
      .select()
      .from(grantSignalAudit)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(grantSignalAudit.createdAt)
  }

  async getPipelineStats() {
    const rows = await this.ctx.db
      .select({
        status: grantApplications.status,
        count: sql<number>`count(*)::int`,
      })
      .from(grantApplications)
      .where(isNull(grantApplications.deletedAt))
      .groupBy(grantApplications.status)

    return rows
  }

  private async recordAudit(data: {
    grantOpportunityId: string
    grantApplicationId?: string
    eventType: string
    actor: string
    details?: Record<string, unknown>
  }) {
    await this.ctx.db.insert(grantSignalAudit).values({
      grantOpportunityId: data.grantOpportunityId,
      grantApplicationId: data.grantApplicationId ?? null,
      eventType: data.eventType,
      actor: data.actor,
      details: data.details ?? {},
    })
  }
}

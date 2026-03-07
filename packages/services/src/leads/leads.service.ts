import { isFeatureEnabled } from '@phyne/config/features'
import { conversions, leads, stageTransitions } from '@phyne/db/schema'
import { eq } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { LeadScoringService } from '../lead-scoring/lead-scoring.service'

export class LeadsService {
  constructor(private readonly ctx: ServiceContext) {}

  async list() {
    return this.ctx.db.select().from(leads).orderBy(leads.createdAt)
  }

  async getById(id: string) {
    const [lead] = await this.ctx.db.select().from(leads).where(eq(leads.id, id))
    return lead ?? null
  }

  async create(data: {
    contactId?: string
    externalJanuaId?: string
    source?: string
    pipelineId: string
    stageId: string
  }) {
    const [lead] = await this.ctx.db.insert(leads).values(data).returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    const created = lead!

    // Auto-record visitor_to_lead conversion
    await this.ctx.db.insert(conversions).values({
      type: 'visitor_to_lead',
      contactId: data.contactId,
      leadId: created.id,
    })

    // Auto-compute lead score on creation
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
    const [lead] = await this.ctx.db.update(leads).set(data).where(eq(leads.id, id)).returning()

    // Auto-recompute lead score on status change
    if (lead && data.status) {
      await this.triggerScoring(id)
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

  async delete(id: string) {
    const [deleted] = await this.ctx.db.delete(leads).where(eq(leads.id, id)).returning()
    return deleted ?? null
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

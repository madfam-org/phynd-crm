import { isFeatureEnabled } from '@phynd/config/features'
import { aiKanbanSuggestions, leads, opportunities, pipelineStages } from '@phynd/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { NotFoundError, ValidationError } from '../errors'
import { LeadsService } from '../leads/leads.service'
import { OpportunitiesService } from '../opportunities/opportunities.service'

export type AiKanbanEntityType = 'lead' | 'opportunity'
export type AiKanbanSuggestionType = 'move_stage'
export type AiKanbanSuggestionStatus = 'pending' | 'approved' | 'rejected'

export interface CreateAiKanbanSuggestionInput {
  entityType: AiKanbanEntityType
  entityId: string
  suggestionType: AiKanbanSuggestionType
  title: string
  rationale?: string
  proposedStageId: string
  source?: string
}

export class AiKanbanService {
  constructor(private readonly ctx: ServiceContext) {}

  private assertEnabled() {
    if (!isFeatureEnabled('aiKanban')) {
      throw new ValidationError('Feature not enabled: aiKanban')
    }
  }

  async createSuggestion(input: CreateAiKanbanSuggestionInput) {
    this.assertEnabled()
    await this.validateEntityAndStage(input.entityType, input.entityId, input.proposedStageId)

    const [existing] = await this.ctx.db
      .select({ id: aiKanbanSuggestions.id })
      .from(aiKanbanSuggestions)
      .where(
        and(
          eq(aiKanbanSuggestions.entityType, input.entityType),
          eq(aiKanbanSuggestions.entityId, input.entityId),
          eq(aiKanbanSuggestions.suggestionType, input.suggestionType),
          eq(aiKanbanSuggestions.status, 'pending'),
        ),
      )
      .limit(1)

    if (existing) {
      throw new ValidationError('A pending suggestion already exists for this entity')
    }

    const [created] = await this.ctx.db
      .insert(aiKanbanSuggestions)
      .values({
        entityType: input.entityType,
        entityId: input.entityId,
        suggestionType: input.suggestionType,
        title: input.title,
        rationale: input.rationale ?? null,
        proposedStageId: input.proposedStageId,
        source: input.source ?? this.ctx.auth.userId,
        status: 'pending',
      })
      .returning()

    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return created!
  }

  async listPending(pipelineId: string) {
    this.assertEnabled()

    const pipelineLeads = await this.ctx.db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.pipelineId, pipelineId), isNull(leads.deletedAt)))

    const pipelineOpps = await this.ctx.db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(eq(opportunities.pipelineId, pipelineId), isNull(opportunities.deletedAt)))

    const leadIds = pipelineLeads.map((row) => row.id)
    const oppIds = pipelineOpps.map((row) => row.id)

    if (leadIds.length === 0 && oppIds.length === 0) {
      return []
    }

    const rows = await this.ctx.db
      .select({
        suggestion: aiKanbanSuggestions,
        proposedStageName: pipelineStages.name,
      })
      .from(aiKanbanSuggestions)
      .leftJoin(pipelineStages, eq(aiKanbanSuggestions.proposedStageId, pipelineStages.id))
      .where(eq(aiKanbanSuggestions.status, 'pending'))

    const leadIdSet = new Set(leadIds)
    const oppIdSet = new Set(oppIds)

    const filtered = rows.filter((row) => {
      if (row.suggestion.entityType === 'lead') {
        return leadIdSet.has(row.suggestion.entityId)
      }
      if (row.suggestion.entityType === 'opportunity') {
        return oppIdSet.has(row.suggestion.entityId)
      }
      return false
    })

    const enriched = await Promise.all(
      filtered.map(async (row) => {
        const entityLabel = await this.resolveEntityLabel(
          row.suggestion.entityType as AiKanbanEntityType,
          row.suggestion.entityId,
        )
        return {
          ...row.suggestion,
          proposedStageName: row.proposedStageName ?? 'Unknown stage',
          entityLabel,
        }
      }),
    )

    return enriched
  }

  async approve(id: string) {
    this.assertEnabled()
    const suggestion = await this.getPending(id)

    if (suggestion.suggestionType === 'move_stage' && suggestion.proposedStageId) {
      await this.applyMoveStage(
        suggestion.entityType as AiKanbanEntityType,
        suggestion.entityId,
        suggestion.proposedStageId,
      )
    }

    const [updated] = await this.ctx.db
      .update(aiKanbanSuggestions)
      .set({
        status: 'approved',
        reviewedBy: this.ctx.auth.userId,
        reviewedAt: new Date(),
      })
      .where(eq(aiKanbanSuggestions.id, id))
      .returning()

    return updated ?? null
  }

  async reject(id: string, _reason?: string) {
    this.assertEnabled()
    await this.getPending(id)

    const [updated] = await this.ctx.db
      .update(aiKanbanSuggestions)
      .set({
        status: 'rejected',
        reviewedBy: this.ctx.auth.userId,
        reviewedAt: new Date(),
      })
      .where(eq(aiKanbanSuggestions.id, id))
      .returning()

    return updated ?? null
  }

  private async getPending(id: string) {
    const [row] = await this.ctx.db
      .select()
      .from(aiKanbanSuggestions)
      .where(and(eq(aiKanbanSuggestions.id, id), eq(aiKanbanSuggestions.status, 'pending')))
    if (!row) throw new NotFoundError('AiKanbanSuggestion', id)
    return row
  }

  private async validateEntityAndStage(
    entityType: AiKanbanEntityType,
    entityId: string,
    proposedStageId: string,
  ) {
    if (entityType === 'lead') {
      const [lead] = await this.ctx.db
        .select()
        .from(leads)
        .where(and(eq(leads.id, entityId), isNull(leads.deletedAt)))
      if (!lead) throw new NotFoundError('Lead', entityId)
      const [stage] = await this.ctx.db
        .select()
        .from(pipelineStages)
        .where(
          and(
            eq(pipelineStages.id, proposedStageId),
            eq(pipelineStages.pipelineId, lead.pipelineId),
          ),
        )
      if (!stage) {
        throw new ValidationError('Proposed stage must belong to the same pipeline as the lead')
      }
      return
    }

    const [opp] = await this.ctx.db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, entityId), isNull(opportunities.deletedAt)))
    if (!opp) throw new NotFoundError('Opportunity', entityId)
    const [stage] = await this.ctx.db
      .select()
      .from(pipelineStages)
      .where(
        and(eq(pipelineStages.id, proposedStageId), eq(pipelineStages.pipelineId, opp.pipelineId)),
      )
    if (!stage) {
      throw new ValidationError(
        'Proposed stage must belong to the same pipeline as the opportunity',
      )
    }
  }

  private async applyMoveStage(entityType: AiKanbanEntityType, entityId: string, stageId: string) {
    if (entityType === 'lead') {
      const service = new LeadsService(this.ctx)
      await service.moveToStage(entityId, stageId)
      return
    }
    const service = new OpportunitiesService(this.ctx)
    await service.moveToStage(entityId, stageId)
  }

  private async resolveEntityLabel(entityType: AiKanbanEntityType, entityId: string) {
    if (entityType === 'lead') {
      const [row] = await this.ctx.db
        .select({ label: leads.source })
        .from(leads)
        .where(eq(leads.id, entityId))
      return row?.label ?? entityId
    }
    const [row] = await this.ctx.db
      .select({ label: opportunities.name })
      .from(opportunities)
      .where(eq(opportunities.id, entityId))
    return row?.label ?? entityId
  }
}

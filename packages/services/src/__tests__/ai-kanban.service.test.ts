import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiKanbanService } from '../ai-kanban/ai-kanban.service'
import { createTestContext } from './helpers'

vi.mock('@phynd/config/features', () => ({
  isFeatureEnabled: vi.fn(() => true),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

vi.mock('@phynd/db/schema', () => ({
  aiKanbanSuggestions: {
    createdAt: 'aiKanbanSuggestions.createdAt',
    entityId: 'aiKanbanSuggestions.entityId',
    entityType: 'aiKanbanSuggestions.entityType',
    id: 'aiKanbanSuggestions.id',
    proposedStageId: 'aiKanbanSuggestions.proposedStageId',
    rationale: 'aiKanbanSuggestions.rationale',
    reviewedAt: 'aiKanbanSuggestions.reviewedAt',
    reviewedBy: 'aiKanbanSuggestions.reviewedBy',
    source: 'aiKanbanSuggestions.source',
    status: 'aiKanbanSuggestions.status',
    suggestionType: 'aiKanbanSuggestions.suggestionType',
    title: 'aiKanbanSuggestions.title',
  },
  leads: {
    deletedAt: 'leads.deletedAt',
    id: 'leads.id',
    pipelineId: 'leads.pipelineId',
    source: 'leads.source',
    stageId: 'leads.stageId',
  },
  opportunities: {
    deletedAt: 'opportunities.deletedAt',
    id: 'opportunities.id',
    name: 'opportunities.name',
    pipelineId: 'opportunities.pipelineId',
    stageId: 'opportunities.stageId',
  },
  pipelineStages: {
    id: 'pipelineStages.id',
    name: 'pipelineStages.name',
    pipelineId: 'pipelineStages.pipelineId',
  },
}))

vi.mock('../leads/leads.service', () => ({
  LeadsService: vi.fn().mockImplementation(() => ({
    moveToStage: vi.fn().mockResolvedValue({ id: 'lead-001' }),
  })),
}))

vi.mock('../opportunities/opportunities.service', () => ({
  OpportunitiesService: vi.fn().mockImplementation(() => ({
    moveToStage: vi.fn().mockResolvedValue({ id: 'opp-001' }),
  })),
}))

describe('AiKanbanService', () => {
  let service: AiKanbanService

  beforeEach(() => {
    const ctx = createTestContext()
    service = new AiKanbanService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('rejects duplicate pending suggestions for the same entity', async () => {
    const ctx = createTestContext()
    const mockDb = ctx.mockDb
    service = new AiKanbanService(ctx)

    let callCount = 0
    mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve([{ id: 'lead-001', pipelineId: 'pipe-1', stageId: 'stage-1' }]).then(
          resolve,
        )
      }
      if (callCount === 2) {
        return Promise.resolve([{ id: 'stage-2', pipelineId: 'pipe-1' }]).then(resolve)
      }
      if (callCount === 3) {
        return Promise.resolve([{ id: 'existing-suggestion' }]).then(resolve)
      }
      return Promise.resolve([]).then(resolve)
    })

    await expect(
      service.createSuggestion({
        entityType: 'lead',
        entityId: 'lead-001',
        suggestionType: 'move_stage',
        title: 'Advance qualified lead',
        proposedStageId: 'stage-2',
      }),
    ).rejects.toThrow('pending suggestion')
  })
})

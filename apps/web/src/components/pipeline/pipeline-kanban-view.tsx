'use client'

import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { AiKanbanReviewPanel } from './ai-kanban-review-panel'
import { KanbanBoard } from './kanban-board'

type RouterOutputs = inferRouterOutputs<AppRouter>
type LeadItem = RouterOutputs['leads']['list']['items'][number]
type OpportunityItem = RouterOutputs['opportunities']['list']['items'][number]
type Stage = RouterOutputs['pipelines']['getStages'][number]

interface PipelineKanbanViewProps {
  pipelineId: string
  stages: Stage[]
  leads: LeadItem[]
  opportunities: OpportunityItem[]
}

export function PipelineKanbanView({
  pipelineId,
  stages,
  leads,
  opportunities,
}: PipelineKanbanViewProps) {
  return (
    <div className="space-y-4">
      <AiKanbanReviewPanel pipelineId={pipelineId} />
      <KanbanBoard stages={stages} leads={leads} opportunities={opportunities} />
    </div>
  )
}

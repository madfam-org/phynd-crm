import { KanbanBoard } from '@/components/pipeline/kanban-board'
import { PipelineSelector } from '@/components/pipeline/pipeline-selector'
import { getServerCaller } from '@/lib/trpc/server'

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ pipelineId?: string }>
}) {
  const caller = await getServerCaller()
  const { pipelineId: selectedId } = await searchParams
  const { items: allPipelines } = await caller.pipelines.list({})
  type PipelineRow = (typeof allPipelines)[number]

  const pipeline =
    allPipelines.find((p: PipelineRow) => p.id === selectedId) ??
    allPipelines.find((p: PipelineRow) => p.isDefault) ??
    allPipelines[0]

  if (!pipeline) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Pipeline</h1>
          <p className="text-muted-foreground">No pipeline configured.</p>
        </div>
      </div>
    )
  }

  const [stages, leads, opportunities] = await Promise.all([
    caller.pipelines.getStages({ pipelineId: pipeline.id }),
    caller.leads.list(),
    caller.opportunities.list(),
  ])

  type LeadRow = (typeof leads.items)[number]
  type OpportunityRow = (typeof opportunities.items)[number]
  const pipelineLeads = leads.items.filter((l: LeadRow) => l.pipelineId === pipeline.id)
  const pipelineOpps = opportunities.items.filter(
    (o: OpportunityRow) => o.pipelineId === pipeline.id,
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pipeline</h1>
          <p className="text-muted-foreground">{pipeline.name}</p>
        </div>
        <PipelineSelector pipelines={allPipelines} selectedId={pipeline.id} />
      </div>
      <KanbanBoard stages={stages} leads={pipelineLeads} opportunities={pipelineOpps} />
    </div>
  )
}

import { KanbanBoard } from '@/components/pipeline/kanban-board'
import { getServerCaller } from '@/lib/trpc/server'

export default async function PipelinePage() {
  const caller = await getServerCaller()
  const pipeline = await caller.pipelines.getDefault()

  if (!pipeline) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Pipeline</h1>
          <p className="text-muted-foreground">No default pipeline configured.</p>
        </div>
      </div>
    )
  }

  const [stages, leads, opportunities] = await Promise.all([
    caller.pipelines.getStages({ pipelineId: pipeline.id }),
    caller.leads.list(),
    caller.opportunities.list(),
  ])

  const pipelineLeads = leads.items.filter((l) => l.pipelineId === pipeline.id)
  const pipelineOpps = opportunities.items.filter((o) => o.pipelineId === pipeline.id)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Pipeline</h1>
        <p className="text-muted-foreground">{pipeline.name}</p>
      </div>
      <KanbanBoard stages={stages} leads={pipelineLeads} opportunities={pipelineOpps} />
    </div>
  )
}

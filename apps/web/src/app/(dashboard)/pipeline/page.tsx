import { Badge } from '@/components/ui/badge'
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
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const stageLeads = pipelineLeads.filter((l) => l.stageId === stage.id)
          const stageOpps = pipelineOpps.filter((o) => o.stageId === stage.id)
          return (
            <div key={stage.id} className="min-w-[250px] flex-shrink-0">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{stage.name}</h3>
                <Badge variant="outline">{stageLeads.length + stageOpps.length}</Badge>
              </div>
              <div className="space-y-2">
                {stageLeads.map((lead) => (
                  <div key={lead.id} className="rounded-lg border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Lead</span>
                      <Badge variant="secondary">{lead.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {lead.source ?? 'No source'} {lead.score != null && `| Score: ${lead.score}`}
                    </p>
                  </div>
                ))}
                {stageOpps.map((opp) => (
                  <div key={opp.id} className="rounded-lg border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{opp.name}</span>
                      <Badge
                        variant={
                          opp.status === 'won'
                            ? 'success'
                            : opp.status === 'lost'
                              ? 'destructive'
                              : 'default'
                        }
                      >
                        {opp.status}
                      </Badge>
                    </div>
                    {opp.value && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        ${Number(opp.value).toLocaleString()}
                      </p>
                    )}
                  </div>
                ))}
                {stageLeads.length === 0 && stageOpps.length === 0 && (
                  <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                    Empty
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

import { PipelineSettings } from '@/components/settings/pipeline-settings'
import { getServerCaller } from '@/lib/trpc/server'

export default async function PipelineSettingsPage() {
  const caller = await getServerCaller()
  const pipelinesData = await caller.pipelines.list()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Pipeline Management</h1>
        <p className="text-muted-foreground">Create and customize pipelines and stages</p>
      </div>
      <PipelineSettings initialPipelines={pipelinesData.items} />
    </div>
  )
}

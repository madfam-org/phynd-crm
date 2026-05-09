'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { CreatePipelineDialog } from './create-pipeline-dialog'
import { EditPipelineDialog } from './edit-pipeline-dialog'
import { PipelineStagesPanel } from './pipeline-stages-panel'

type RouterOutputs = inferRouterOutputs<AppRouter>
type Pipeline = RouterOutputs['pipelines']['list']['items'][number]

interface PipelineSettingsProps {
  initialPipelines: Pipeline[]
}

export function PipelineSettings({ initialPipelines }: PipelineSettingsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editPipeline, setEditPipeline] = useState<Pipeline | null>(null)
  const [deletePipeline, setDeletePipeline] = useState<Pipeline | null>(null)

  const { data: pipelinesData } = trpc.pipelines.list.useQuery(undefined, {
    initialData: { hasMore: false, items: initialPipelines, nextCursor: null },
  })

  const pipelinesList = pipelinesData?.items ?? initialPipelines

  const utils = trpc.useUtils()
  const deleteMutation = trpc.pipelines.delete.useMutation({
    onSuccess: () => {
      utils.pipelines.list.invalidate()
      setDeletePipeline(null)
      if (selectedId === deletePipeline?.id) {
        setSelectedId(null)
      }
    },
    onError: (err) => toast.error('Failed to delete pipeline', { description: err.message }),
  })

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Pipelines</h2>
          <CreatePipelineDialog />
        </div>
        <div className="space-y-2">
          {pipelinesList.map((pipeline) => (
            <Card
              key={pipeline.id}
              className={`cursor-pointer transition-colors ${selectedId === pipeline.id ? 'border-primary' : ''}`}
              onClick={() => setSelectedId(pipeline.id)}
            >
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{pipeline.name}</span>
                  {pipeline.isDefault && <Badge variant="secondary">Default</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditPipeline(pipeline)
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeletePipeline(pipeline)
                    }}
                    disabled={pipeline.isDefault}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {pipelinesList.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No pipelines yet. Create one to get started.
            </p>
          )}
        </div>
      </div>

      <div>
        {selectedId ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {pipelinesList.find((p) => p.id === selectedId)?.name ?? 'Pipeline'} Stages
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PipelineStagesPanel pipelineId={selectedId} />
            </CardContent>
          </Card>
        ) : (
          <div className="flex items-center justify-center rounded-lg border border-dashed p-12">
            <p className="text-sm text-muted-foreground">Select a pipeline to manage its stages</p>
          </div>
        )}
      </div>

      <EditPipelineDialog pipeline={editPipeline} onClose={() => setEditPipeline(null)} />

      <Dialog open={!!deletePipeline} onOpenChange={(open) => !open && setDeletePipeline(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Pipeline</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deletePipeline?.name}&quot;? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePipeline(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletePipeline && deleteMutation.mutate({ id: deletePipeline.id })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

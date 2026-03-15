'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { trpc } from '@/lib/trpc/client'
import { DragDropContext, Draggable, type DropResult, Droppable } from '@hello-pangea/dnd'
import { GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

interface Stage {
  id: string
  name: string
  position: number
  probability: number | null
}

interface PipelineStagesPanelProps {
  pipelineId: string
}

export function PipelineStagesPanel({ pipelineId }: PipelineStagesPanelProps) {
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newProbability, setNewProbability] = useState('')
  const [editingStage, setEditingStage] = useState<Stage | null>(null)
  const [editName, setEditName] = useState('')
  const [editProbability, setEditProbability] = useState('')

  const utils = trpc.useUtils()
  const { data: stages = [] } = trpc.pipelines.getStages.useQuery({ pipelineId })

  const createStageMutation = trpc.pipelines.createStage.useMutation({
    onSuccess: () => {
      utils.pipelines.getStages.invalidate({ pipelineId })
      setShowAdd(false)
      setNewName('')
      setNewProbability('')
    },
    onError: (err) => toast.error('Failed to create stage', { description: err.message }),
  })

  const updateStageMutation = trpc.pipelines.updateStage.useMutation({
    onSuccess: () => {
      utils.pipelines.getStages.invalidate({ pipelineId })
      setEditingStage(null)
    },
    onError: (err) => toast.error('Failed to update stage', { description: err.message }),
  })

  const deleteStageMutation = trpc.pipelines.deleteStage.useMutation({
    onSuccess: () => {
      utils.pipelines.getStages.invalidate({ pipelineId })
    },
    onError: (err) => toast.error('Failed to delete stage', { description: err.message }),
  })

  const reorderMutation = trpc.pipelines.reorderStages.useMutation({
    onSuccess: () => {
      utils.pipelines.getStages.invalidate({ pipelineId })
    },
    onError: (err) => toast.error('Failed to reorder stages', { description: err.message }),
  })

  function handleAddStage(e: React.FormEvent) {
    e.preventDefault()
    createStageMutation.mutate({
      name: newName,
      pipelineId,
      position: stages.length,
      probability: newProbability ? Number(newProbability) : undefined,
    })
  }

  function handleEditStage(e: React.FormEvent) {
    e.preventDefault()
    if (!editingStage) return
    updateStageMutation.mutate({
      id: editingStage.id,
      name: editName,
      probability: editProbability ? Number(editProbability) : undefined,
    })
  }

  function startEditing(stage: Stage) {
    setEditingStage(stage)
    setEditName(stage.name)
    setEditProbability(stage.probability?.toString() ?? '')
  }

  function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    const reordered = Array.from(stages)
    const [moved] = reordered.splice(result.source.index, 1)
    if (!moved) return
    reordered.splice(result.destination.index, 0, moved)
    reorderMutation.mutate({
      pipelineId,
      stageIds: reordered.map((s) => s.id),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Stages</h3>
        <Button variant="outline" size="sm" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? <X className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}
          {showAdd ? 'Cancel' : 'Add Stage'}
        </Button>
      </div>

      {showAdd && (
        <form onSubmit={handleAddStage} className="flex gap-2 items-end">
          <div className="grid gap-1 flex-1">
            <Label htmlFor="new-stage-name" className="text-xs">
              Name
            </Label>
            <Input
              id="new-stage-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Stage name"
              required
            />
          </div>
          <div className="grid gap-1 w-24">
            <Label htmlFor="new-stage-prob" className="text-xs">
              Probability %
            </Label>
            <Input
              id="new-stage-prob"
              type="number"
              min={0}
              max={100}
              value={newProbability}
              onChange={(e) => setNewProbability(e.target.value)}
              placeholder="50"
            />
          </div>
          <Button type="submit" size="sm" disabled={createStageMutation.isPending || !newName}>
            Add
          </Button>
        </form>
      )}

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="stages">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-1">
              {stages.map((stage, index) => (
                <Draggable key={stage.id} draggableId={stage.id} index={index}>
                  {(dragProvided) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      className="flex items-center gap-2 rounded-md border bg-card p-2"
                    >
                      <div {...dragProvided.dragHandleProps} className="cursor-grab">
                        <GripVertical
                          className="h-4 w-4 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </div>
                      {editingStage?.id === stage.id ? (
                        <form onSubmit={handleEditStage} className="flex flex-1 items-center gap-2">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-8"
                            required
                          />
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={editProbability}
                            onChange={(e) => setEditProbability(e.target.value)}
                            className="h-8 w-20"
                            placeholder="%"
                          />
                          <Button
                            type="submit"
                            size="sm"
                            variant="ghost"
                            disabled={updateStageMutation.isPending}
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingStage(null)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </form>
                      ) : (
                        <>
                          <span className="flex-1 text-sm">{stage.name}</span>
                          {stage.probability != null && (
                            <span className="text-xs text-muted-foreground">
                              {stage.probability}%
                            </span>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => startEditing(stage)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteStageMutation.mutate({ id: stage.id })}
                            disabled={deleteStageMutation.isPending}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {stages.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No stages yet. Add a stage to get started.
        </p>
      )}
    </div>
  )
}

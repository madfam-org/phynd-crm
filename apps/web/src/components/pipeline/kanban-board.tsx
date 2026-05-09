'use client'

import { Badge } from '@/components/ui/badge'
import { trpc } from '@/lib/trpc/client'
import { DragDropContext, Draggable, type DropResult, Droppable } from '@hello-pangea/dnd'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { KanbanCard } from './kanban-card'

type RouterOutputs = inferRouterOutputs<AppRouter>
type LeadItem = RouterOutputs['leads']['list']['items'][number]
type OpportunityItem = RouterOutputs['opportunities']['list']['items'][number]
type Stage = RouterOutputs['pipelines']['getStages'][number]

interface KanbanBoardProps {
  stages: Stage[]
  leads: LeadItem[]
  opportunities: OpportunityItem[]
}

export function KanbanBoard({
  stages,
  leads: initialLeads,
  opportunities: initialOpps,
}: KanbanBoardProps) {
  const [leads, setLeads] = useState(initialLeads)
  const [opportunities, setOpportunities] = useState(initialOpps)

  const utils = trpc.useUtils()

  const moveLeadMutation = trpc.leads.moveToStage.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate()
    },
    onError: (error) => {
      toast.error(`Failed to move lead: ${error.message}`)
      utils.leads.list.invalidate()
    },
  })

  const moveOppMutation = trpc.opportunities.moveToStage.useMutation({
    onSuccess: () => {
      utils.opportunities.list.invalidate()
    },
    onError: (error) => {
      toast.error(`Failed to move opportunity: ${error.message}`)
      utils.opportunities.list.invalidate()
    },
  })

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination } = result

      if (!destination) return

      const destinationStageId = destination.droppableId

      if (draggableId.startsWith('lead-')) {
        const leadId = draggableId.replace('lead-', '')
        const lead = leads.find((l) => l.id === leadId)

        if (!lead || lead.stageId === destinationStageId) return

        // Optimistic update
        setLeads((prev) =>
          prev.map((l) => (l.id === leadId ? { ...l, stageId: destinationStageId } : l)),
        )

        moveLeadMutation.mutate({
          id: leadId,
          stageId: destinationStageId,
        })
      } else if (draggableId.startsWith('opp-')) {
        const oppId = draggableId.replace('opp-', '')
        const opp = opportunities.find((o) => o.id === oppId)

        if (!opp || opp.stageId === destinationStageId) return

        // Optimistic update
        setOpportunities((prev) =>
          prev.map((o) => (o.id === oppId ? { ...o, stageId: destinationStageId } : o)),
        )

        moveOppMutation.mutate({
          id: oppId,
          stageId: destinationStageId,
        })
      }
    },
    [leads, opportunities, moveLeadMutation, moveOppMutation],
  )

  const sortedStages = [...stages].sort((a, b) => a.position - b.position)

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {sortedStages.map((stage) => {
          const stageLeads = leads.filter((l) => l.stageId === stage.id)
          const stageOpps = opportunities.filter((o) => o.stageId === stage.id)
          const totalCards = stageLeads.length + stageOpps.length

          return (
            <div key={stage.id} className="min-w-[250px] flex-shrink-0">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{stage.name}</h3>
                <Badge variant="outline">{totalCards}</Badge>
              </div>
              <Droppable droppableId={stage.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`min-h-[100px] space-y-2 rounded-lg border border-dashed p-2 transition-colors ${
                      snapshot.isDraggingOver ? 'border-primary bg-primary/5' : 'border-transparent'
                    }`}
                    aria-label={`${stage.name} stage`}
                  >
                    {stageLeads.map((lead, index) => (
                      <Draggable
                        key={`lead-${lead.id}`}
                        draggableId={`lead-${lead.id}`}
                        index={index}
                      >
                        {(dragProvided, dragSnapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            {...dragProvided.dragHandleProps}
                            className={`transition-shadow ${dragSnapshot.isDragging ? 'shadow-lg' : ''}`}
                            aria-label={`Lead: ${lead.source ?? 'No source'}, status ${lead.status}`}
                          >
                            <KanbanCard
                              id={lead.id}
                              type="lead"
                              title={lead.source ?? 'Lead'}
                              status={lead.status}
                              score={lead.score}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {stageOpps.map((opp, index) => (
                      <Draggable
                        key={`opp-${opp.id}`}
                        draggableId={`opp-${opp.id}`}
                        index={stageLeads.length + index}
                      >
                        {(dragProvided, dragSnapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            {...dragProvided.dragHandleProps}
                            className={`transition-shadow ${dragSnapshot.isDragging ? 'shadow-lg' : ''}`}
                            aria-label={`Opportunity: ${opp.name}, status ${opp.status}${opp.value ? `, value $${Number(opp.value).toLocaleString()}` : ''}`}
                          >
                            <KanbanCard
                              id={opp.id}
                              type="opportunity"
                              title={opp.name}
                              status={opp.status}
                              value={opp.value}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {totalCards === 0 && !snapshot.isDraggingOver && (
                      <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                        Empty
                      </p>
                    )}
                  </div>
                )}
              </Droppable>
            </div>
          )
        })}
      </div>
    </DragDropContext>
  )
}

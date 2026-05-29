'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { trpc } from '@/lib/trpc/client'
import { toast } from 'sonner'

interface AiKanbanReviewPanelProps {
  pipelineId: string
}

export function AiKanbanReviewPanel({ pipelineId }: AiKanbanReviewPanelProps) {
  const aiKanbanRouter = trpc.aiKanban as NonNullable<typeof trpc.aiKanban>
  const listPending = aiKanbanRouter.listPending as NonNullable<typeof aiKanbanRouter.listPending>
  const approve = aiKanbanRouter.approve as NonNullable<typeof aiKanbanRouter.approve>
  const reject = aiKanbanRouter.reject as NonNullable<typeof aiKanbanRouter.reject>

  const { data: suggestions = [], error, refetch } = listPending.useQuery(
    { pipelineId },
    { retry: false },
  )

  if (error?.message.includes('aiKanban')) {
    return null
  }
  const approveMutation = approve.useMutation({
    onSuccess: () => {
      toast.success('Suggestion applied')
      refetch()
    },
    onError: (error) => toast.error(error.message),
  })
  const rejectMutation = reject.useMutation({
    onSuccess: () => {
      toast.success('Suggestion dismissed')
      refetch()
    },
    onError: (error) => toast.error(error.message),
  })

  if (suggestions.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI pipeline suggestions ({suggestions.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.id}
            className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="space-y-1">
              <p className="text-sm font-medium">{suggestion.title}</p>
              <p className="text-xs text-muted-foreground">
                {suggestion.entityType} · {suggestion.entityLabel} → {suggestion.proposedStageName}
              </p>
              {suggestion.rationale && (
                <p className="text-xs text-muted-foreground">{suggestion.rationale}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={rejectMutation.isPending}
                onClick={() => rejectMutation.mutate({ id: suggestion.id })}
              >
                Dismiss
              </Button>
              <Button
                size="sm"
                disabled={approveMutation.isPending}
                onClick={() => approveMutation.mutate({ id: suggestion.id })}
              >
                Apply move
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { trpc } from '@/lib/trpc/client'
import { toast } from 'sonner'

interface DeleteOpportunityDialogProps {
  opportunityId: string
  opportunityLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteOpportunityDialog({
  opportunityId,
  opportunityLabel,
  open,
  onOpenChange,
}: DeleteOpportunityDialogProps) {
  const utils = trpc.useUtils()
  const opportunitiesRouter = trpc.opportunities as NonNullable<typeof trpc.opportunities>
  const deleteOpportunity = opportunitiesRouter.delete as NonNullable<
    typeof opportunitiesRouter.delete
  >
  const opportunitiesUtils = utils.opportunities as NonNullable<typeof utils.opportunities>
  const listOppsUtils = opportunitiesUtils.list as NonNullable<typeof opportunitiesUtils.list>
  const listMineOppsUtils = opportunitiesUtils.listMine as NonNullable<
    typeof opportunitiesUtils.listMine
  >

  const deleteMutation = deleteOpportunity.useMutation({
    onSuccess: () => {
      listOppsUtils.invalidate()
      listMineOppsUtils.invalidate()
      onOpenChange(false)
    },
    onError: (err) => toast.error('Failed to delete opportunity', { description: err.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Opportunity</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete opportunity <strong>{opportunityLabel}</strong>? This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate({ id: opportunityId })}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

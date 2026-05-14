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

interface DeleteActivityDialogProps {
  activityId: string
  activityTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteActivityDialog({
  activityId,
  activityTitle,
  open,
  onOpenChange,
}: DeleteActivityDialogProps) {
  const utils = trpc.useUtils()
  const activitiesRouter = trpc.activities as NonNullable<typeof trpc.activities>
  const deleteActivity = activitiesRouter.delete as NonNullable<typeof activitiesRouter.delete>
  const activitiesUtils = utils.activities as NonNullable<typeof utils.activities>
  const listUtils = activitiesUtils.list as NonNullable<typeof activitiesUtils.list>
  const deleteMutation = deleteActivity.useMutation({
    onSuccess: () => {
      listUtils.invalidate()
      onOpenChange(false)
    },
    onError: (err) => toast.error('Failed to delete activity', { description: err.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Activity</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{activityTitle}</strong>? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate({ id: activityId })}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

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
  const deleteMutation = trpc.activities.delete.useMutation({
    onSuccess: () => {
      utils.activities.list.invalidate()
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

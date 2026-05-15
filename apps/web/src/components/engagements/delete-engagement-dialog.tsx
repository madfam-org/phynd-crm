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

interface DeleteEngagementDialogProps {
  engagementId: string
  projectName: string
  contactId?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
}

export function DeleteEngagementDialog({
  engagementId,
  projectName,
  contactId,
  open,
  onOpenChange,
  onDeleted,
}: DeleteEngagementDialogProps) {
  const utils = trpc.useUtils()
  const engagementsRouter = trpc.engagements as NonNullable<typeof trpc.engagements>
  const deleteEngagement = engagementsRouter.delete as NonNullable<typeof engagementsRouter.delete>
  const engagementsUtils = utils.engagements as NonNullable<typeof utils.engagements>
  const listEngagementsUtils = engagementsUtils.list as NonNullable<typeof engagementsUtils.list>
  const listByContactUtils = engagementsUtils.listByContactId as NonNullable<
    typeof engagementsUtils.listByContactId
  >
  const deleteMutation = deleteEngagement.useMutation({
    onSuccess: () => {
      listEngagementsUtils.invalidate()
      if (contactId) {
        listByContactUtils.invalidate({ contactId })
      }
      toast.success('Engagement deleted')
      onOpenChange(false)
      onDeleted?.()
    },
    onError: (err) => toast.error('Failed to delete engagement', { description: err.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Engagement</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{projectName}</strong>? This soft-deletes the
            engagement and hides it from the client portal. Artifacts and events are preserved in
            the database but will no longer be surfaced.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate({ id: engagementId })}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

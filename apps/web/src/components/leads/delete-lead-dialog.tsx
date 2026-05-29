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

interface DeleteLeadDialogProps {
  leadId: string
  leadLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteLeadDialog({ leadId, leadLabel, open, onOpenChange }: DeleteLeadDialogProps) {
  const utils = trpc.useUtils()
  const leadsRouter = trpc.leads as NonNullable<typeof trpc.leads>
  const deleteLead = leadsRouter.delete as NonNullable<typeof leadsRouter.delete>
  const leadsUtils = utils.leads as NonNullable<typeof utils.leads>
  const listLeadsUtils = leadsUtils.list as NonNullable<typeof leadsUtils.list>
  const listMineLeadsUtils = leadsUtils.listMine as NonNullable<typeof leadsUtils.listMine>

  const deleteMutation = deleteLead.useMutation({
    onSuccess: () => {
      listLeadsUtils.invalidate()
      listMineLeadsUtils.invalidate()
      onOpenChange(false)
    },
    onError: (err) => toast.error('Failed to delete lead', { description: err.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Lead</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete lead <strong>{leadLabel}</strong>? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate({ id: leadId })}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

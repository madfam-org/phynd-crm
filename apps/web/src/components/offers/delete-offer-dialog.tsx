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

interface DeleteOfferDialogProps {
  offerId: string
  offerName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteOfferDialog({
  offerId,
  offerName,
  open,
  onOpenChange,
}: DeleteOfferDialogProps) {
  const utils = trpc.useUtils()
  const offersRouter = trpc.offers as NonNullable<typeof trpc.offers>
  const deleteOffer = offersRouter.delete as NonNullable<typeof offersRouter.delete>
  const offersUtils = utils.offers as NonNullable<typeof utils.offers>
  const listOffersUtils = offersUtils.list as NonNullable<typeof offersUtils.list>
  const deleteMutation = deleteOffer.useMutation({
    onSuccess: () => {
      listOffersUtils.invalidate()
      onOpenChange(false)
    },
    onError: (err) => toast.error('Failed to delete offer', { description: err.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Offer</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{offerName}</strong>? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate({ id: offerId })}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

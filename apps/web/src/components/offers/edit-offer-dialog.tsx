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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { trpc } from '@/lib/trpc/client'
import { useState } from 'react'
import { toast } from 'sonner'

interface EditOfferDialogProps {
  offer: {
    id: string
    name: string
    description: string | null
    type: string
    value: string | null
    currency: string | null
    validFrom: Date | string | null
    validUntil: Date | string | null
    maxRedemptions: number | null
    status: string
  }
  open: boolean
  onOpenChange: (open: boolean) => void
}

function toDateInputValue(date: Date | string | null): string {
  if (!date) return ''
  const d = new Date(date)
  return d.toISOString().slice(0, 10)
}

export function EditOfferDialog({ offer, open, onOpenChange }: EditOfferDialogProps) {
  const [name, setName] = useState(offer.name)
  const [description, setDescription] = useState(offer.description ?? '')
  const [type, setType] = useState(offer.type)
  const [value, setValue] = useState(offer.value ?? '')
  const [currency, setCurrency] = useState(offer.currency ?? '')
  const [validFrom, setValidFrom] = useState(toDateInputValue(offer.validFrom))
  const [validUntil, setValidUntil] = useState(toDateInputValue(offer.validUntil))
  const [maxRedemptions, setMaxRedemptions] = useState(
    offer.maxRedemptions != null ? String(offer.maxRedemptions) : '',
  )
  const [status, setStatus] = useState(offer.status)

  const utils = trpc.useUtils()
  const offersRouter = trpc.offers as NonNullable<typeof trpc.offers>
  const updateOffer = offersRouter.update as NonNullable<typeof offersRouter.update>
  const offersUtils = utils.offers as NonNullable<typeof utils.offers>
  const listOffersUtils = offersUtils.list as NonNullable<typeof offersUtils.list>
  const updateMutation = updateOffer.useMutation({
    onSuccess: () => {
      listOffersUtils.invalidate()
      onOpenChange(false)
    },
    onError: (err) => toast.error('Failed to update offer', { description: err.message }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    updateMutation.mutate({
      id: offer.id,
      name,
      description: description || undefined,
      type: type as 'discount' | 'bundle' | 'free_trial' | 'custom',
      value: value || undefined,
      currency: currency || undefined,
      validFrom: validFrom ? new Date(validFrom) : undefined,
      validUntil: validUntil ? new Date(validUntil) : undefined,
      maxRedemptions: maxRedemptions ? Number(maxRedemptions) : undefined,
      status: status as 'draft' | 'active' | 'paused' | 'expired',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Offer</DialogTitle>
            <DialogDescription>Update offer details and status.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-offer-name">Name *</Label>
              <Input
                id="edit-offer-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-offer-description">Description</Label>
              <Textarea
                id="edit-offer-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="discount">Discount</SelectItem>
                    <SelectItem value="bundle">Bundle</SelectItem>
                    <SelectItem value="free_trial">Free Trial</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-offer-value">Value</Label>
                <Input
                  id="edit-offer-value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="e.g. 10.00"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-offer-currency">Currency</Label>
                <Input
                  id="edit-offer-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  placeholder="e.g. USD"
                  maxLength={3}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-offer-valid-from">Valid From</Label>
                <Input
                  id="edit-offer-valid-from"
                  type="date"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-offer-valid-until">Valid Until</Label>
                <Input
                  id="edit-offer-valid-until"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-offer-max-redemptions">Max Redemptions</Label>
              <Input
                id="edit-offer-max-redemptions"
                type="number"
                min={1}
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

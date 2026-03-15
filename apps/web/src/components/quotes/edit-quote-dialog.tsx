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
import { trpc } from '@/lib/trpc/client'
import { useState } from 'react'
import { toast } from 'sonner'

interface EditQuoteDialogProps {
  quote: {
    id: string
    quoteNumber: string
    totalAmount: string | null
    currency: string
    status: string
    validUntil: Date | null
    ownerId: string | null
  }
  open: boolean
  onOpenChange: (open: boolean) => void
}

const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'] as const

export function EditQuoteDialog({ quote, open, onOpenChange }: EditQuoteDialogProps) {
  const [quoteNumber, setQuoteNumber] = useState(quote.quoteNumber)
  const [totalAmount, setTotalAmount] = useState(quote.totalAmount ?? '')
  const [currency, setCurrency] = useState(quote.currency)
  const [status, setStatus] = useState(quote.status)
  const [validUntil, setValidUntil] = useState(
    quote.validUntil ? new Date(quote.validUntil).toISOString().split('T')[0] : '',
  )
  const [ownerId, setOwnerId] = useState(quote.ownerId ?? '')

  const { data: usersData } = trpc.users.list.useQuery(undefined, { retry: false })

  const utils = trpc.useUtils()
  const updateMutation = trpc.quotes.update.useMutation({
    onSuccess: () => {
      utils.quotes.list.invalidate()
      utils.quotes.listMine.invalidate()
      onOpenChange(false)
    },
    onError: (err) => toast.error('Failed to update quote', { description: err.message }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    updateMutation.mutate({
      id: quote.id,
      quoteNumber,
      totalAmount: totalAmount || undefined,
      currency: currency || undefined,
      status: status as (typeof QUOTE_STATUSES)[number],
      validUntil: validUntil ? new Date(validUntil) : undefined,
      ownerId: ownerId || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Quote</DialogTitle>
            <DialogDescription>Update quote details.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-quote-number">Quote Number *</Label>
              <Input
                id="edit-quote-number"
                value={quoteNumber}
                onChange={(e) => setQuoteNumber(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-quote-amount">Amount ($)</Label>
                <Input
                  id="edit-quote-amount"
                  type="number"
                  step="0.01"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-quote-currency">Currency</Label>
                <Input
                  id="edit-quote-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  maxLength={10}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {QUOTE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-quote-valid-until">Valid Until</Label>
              <Input
                id="edit-quote-valid-until"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select owner" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {(usersData?.items ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name ?? u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending || !quoteNumber}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

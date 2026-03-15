'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

export function CreateOrderDialog() {
  const [open, setOpen] = useState(false)
  const [orderNumber, setOrderNumber] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [estimatedCompletion, setEstimatedCompletion] = useState('')
  const [opportunityId, setOpportunityId] = useState('')
  const [quoteId, setQuoteId] = useState('')
  const [contactId, setContactId] = useState('')

  const { data: opportunities } = trpc.opportunities.list.useQuery()
  const { data: quotesData } = trpc.quotes.list.useQuery()
  const { data: contacts } = trpc.contacts.list.useQuery()

  const utils = trpc.useUtils()
  const createMutation = trpc.orders.create.useMutation({
    onSuccess: () => {
      utils.orders.list.invalidate()
      setOpen(false)
      resetForm()
    },
    onError: (err) => toast.error('Failed to create order', { description: err.message }),
  })

  function resetForm() {
    setOrderNumber('')
    setTotalAmount('')
    setCurrency('USD')
    setEstimatedCompletion('')
    setOpportunityId('')
    setQuoteId('')
    setContactId('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createMutation.mutate({
      orderNumber,
      totalAmount: totalAmount || undefined,
      currency: currency || undefined,
      estimatedCompletion: estimatedCompletion ? new Date(estimatedCompletion) : undefined,
      opportunityId: opportunityId || undefined,
      quoteId: quoteId || undefined,
      contactId: contactId || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create Order</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Order</DialogTitle>
            <DialogDescription>Add a new order.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="order-number">Order Number *</Label>
              <Input
                id="order-number"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="order-amount">Amount ($)</Label>
                <Input
                  id="order-amount"
                  type="number"
                  step="0.01"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="order-currency">Currency</Label>
                <Input
                  id="order-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  maxLength={10}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="order-est-completion">Est. Completion</Label>
              <Input
                id="order-est-completion"
                type="date"
                value={estimatedCompletion}
                onChange={(e) => setEstimatedCompletion(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Opportunity</Label>
              <Select value={opportunityId} onValueChange={setOpportunityId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select opportunity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {(opportunities?.items ?? []).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Quote</Label>
              <Select value={quoteId} onValueChange={setQuoteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select quote" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {(quotesData?.items ?? []).map((q) => (
                    <SelectItem key={q.id} value={q.id}>
                      {q.quoteNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Contact</Label>
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select contact" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {(contacts?.items ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !orderNumber}>
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

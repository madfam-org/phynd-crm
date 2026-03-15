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

export function CreateQuoteDialog() {
  const [open, setOpen] = useState(false)
  const [quoteNumber, setQuoteNumber] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [validUntil, setValidUntil] = useState('')
  const [opportunityId, setOpportunityId] = useState('')
  const [contactId, setContactId] = useState('')

  const { data: opportunities } = trpc.opportunities.list.useQuery()
  const { data: contacts } = trpc.contacts.list.useQuery()

  const utils = trpc.useUtils()
  const createMutation = trpc.quotes.create.useMutation({
    onSuccess: () => {
      utils.quotes.list.invalidate()
      setOpen(false)
      resetForm()
    },
    onError: (err) => toast.error('Failed to create quote', { description: err.message }),
  })

  function resetForm() {
    setQuoteNumber('')
    setTotalAmount('')
    setCurrency('USD')
    setValidUntil('')
    setOpportunityId('')
    setContactId('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createMutation.mutate({
      quoteNumber,
      totalAmount: totalAmount || undefined,
      currency: currency || undefined,
      validUntil: validUntil ? new Date(validUntil) : undefined,
      opportunityId: opportunityId || undefined,
      contactId: contactId || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create Quote</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Quote</DialogTitle>
            <DialogDescription>Add a new quote.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="quote-number">Quote Number *</Label>
              <Input
                id="quote-number"
                value={quoteNumber}
                onChange={(e) => setQuoteNumber(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="quote-amount">Amount ($)</Label>
                <Input
                  id="quote-amount"
                  type="number"
                  step="0.01"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="quote-currency">Currency</Label>
                <Input
                  id="quote-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  maxLength={10}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="quote-valid-until">Valid Until</Label>
              <Input
                id="quote-valid-until"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
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
            <Button
              type="submit"
              disabled={createMutation.isPending || !quoteNumber}
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

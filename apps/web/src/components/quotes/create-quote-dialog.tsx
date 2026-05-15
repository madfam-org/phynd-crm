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
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useState } from 'react'
import { toast } from 'sonner'

type RouterOutputs = inferRouterOutputs<AppRouter>
type OpportunitiesListOutput = RouterOutputs['opportunities']['list']
type ContactsListOutput = RouterOutputs['contacts']['list']
type OpportunityOption = OpportunitiesListOutput['items'][number]
type ContactOption = ContactsListOutput['items'][number]

export function CreateQuoteDialog() {
  const [open, setOpen] = useState(false)
  const [quoteNumber, setQuoteNumber] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [validUntil, setValidUntil] = useState('')
  const [opportunityId, setOpportunityId] = useState('')
  const [contactId, setContactId] = useState('')

  const opportunitiesRouter = trpc.opportunities as NonNullable<typeof trpc.opportunities>
  const contactsRouter = trpc.contacts as NonNullable<typeof trpc.contacts>
  const quotesRouter = trpc.quotes as NonNullable<typeof trpc.quotes>
  const listOpportunities = opportunitiesRouter.list as NonNullable<
    typeof opportunitiesRouter.list
  >
  const listContacts = contactsRouter.list as NonNullable<typeof contactsRouter.list>
  const createQuote = quotesRouter.create as NonNullable<typeof quotesRouter.create>
  const { data: opportunitiesData } = listOpportunities.useQuery()
  const { data: contactsData } = listContacts.useQuery()
  const opportunities = (opportunitiesData as OpportunitiesListOutput | undefined)?.items ?? []
  const contacts = (contactsData as ContactsListOutput | undefined)?.items ?? []

  const utils = trpc.useUtils()
  const quotesUtils = utils.quotes as NonNullable<typeof utils.quotes>
  const listQuotesUtils = quotesUtils.list as NonNullable<typeof quotesUtils.list>
  const createMutation = createQuote.useMutation({
    onSuccess: () => {
      listQuotesUtils.invalidate()
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
                  {opportunities.map((o: OpportunityOption) => (
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
                  {contacts.map((c: ContactOption) => (
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
            <Button type="submit" disabled={createMutation.isPending || !quoteNumber}>
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

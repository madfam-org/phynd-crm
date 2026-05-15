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
type QuotesListOutput = RouterOutputs['quotes']['list']
type ContactsListOutput = RouterOutputs['contacts']['list']
type OpportunityOption = OpportunitiesListOutput['items'][number]
type QuoteOption = QuotesListOutput['items'][number]
type ContactOption = ContactsListOutput['items'][number]

export function CreateOrderDialog() {
  const [open, setOpen] = useState(false)
  const [orderNumber, setOrderNumber] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [estimatedCompletion, setEstimatedCompletion] = useState('')
  const [opportunityId, setOpportunityId] = useState('')
  const [quoteId, setQuoteId] = useState('')
  const [contactId, setContactId] = useState('')

  const opportunitiesRouter = trpc.opportunities as NonNullable<typeof trpc.opportunities>
  const quotesRouter = trpc.quotes as NonNullable<typeof trpc.quotes>
  const contactsRouter = trpc.contacts as NonNullable<typeof trpc.contacts>
  const ordersRouter = trpc.orders as NonNullable<typeof trpc.orders>
  const listOpportunities = opportunitiesRouter.list as NonNullable<
    typeof opportunitiesRouter.list
  >
  const listQuotes = quotesRouter.list as NonNullable<typeof quotesRouter.list>
  const listContacts = contactsRouter.list as NonNullable<typeof contactsRouter.list>
  const createOrder = ordersRouter.create as NonNullable<typeof ordersRouter.create>
  const { data: opportunitiesData } = listOpportunities.useQuery()
  const { data: quotesData } = listQuotes.useQuery()
  const { data: contactsData } = listContacts.useQuery()
  const opportunities = (opportunitiesData as OpportunitiesListOutput | undefined)?.items ?? []
  const quotes = (quotesData as QuotesListOutput | undefined)?.items ?? []
  const contacts = (contactsData as ContactsListOutput | undefined)?.items ?? []

  const utils = trpc.useUtils()
  const ordersUtils = utils.orders as NonNullable<typeof utils.orders>
  const listOrdersUtils = ordersUtils.list as NonNullable<typeof ordersUtils.list>
  const createMutation = createOrder.useMutation({
    onSuccess: () => {
      listOrdersUtils.invalidate()
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
                  {opportunities.map((o: OpportunityOption) => (
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
                  {quotes.map((q: QuoteOption) => (
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
            <Button type="submit" disabled={createMutation.isPending || !orderNumber}>
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

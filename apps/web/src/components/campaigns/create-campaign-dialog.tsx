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
import { Textarea } from '@/components/ui/textarea'
import { trpc } from '@/lib/trpc/client'
import { useState } from 'react'
import { toast } from 'sonner'

const CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'social', label: 'Social' },
  { value: 'paid_search', label: 'Paid Search' },
  { value: 'organic', label: 'Organic' },
  { value: 'referral', label: 'Referral' },
  { value: 'direct', label: 'Direct' },
  { value: 'other', label: 'Other' },
] as const

export function CreateCampaignDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [channel, setChannel] = useState<string>('')
  const [utmSource, setUtmSource] = useState('')
  const [utmMedium, setUtmMedium] = useState('')
  const [utmCampaign, setUtmCampaign] = useState('')
  const [budget, setBudget] = useState('')
  const [currency, setCurrency] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [offerId, setOfferId] = useState('')

  const { data: offersData } = trpc.offers.list.useQuery(undefined, { retry: false })

  const utils = trpc.useUtils()
  const createMutation = trpc.campaigns.create.useMutation({
    onSuccess: () => {
      utils.campaigns.list.invalidate()
      setOpen(false)
      resetForm()
    },
    onError: (err) => toast.error('Failed to create campaign', { description: err.message }),
  })

  function resetForm() {
    setName('')
    setDescription('')
    setChannel('')
    setUtmSource('')
    setUtmMedium('')
    setUtmCampaign('')
    setBudget('')
    setCurrency('')
    setStartDate('')
    setEndDate('')
    setOfferId('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createMutation.mutate({
      name,
      description: description || undefined,
      channel:
        (channel as
          | 'email'
          | 'social'
          | 'paid_search'
          | 'organic'
          | 'referral'
          | 'direct'
          | 'other') || undefined,
      utmSource: utmSource || undefined,
      utmMedium: utmMedium || undefined,
      utmCampaign: utmCampaign || undefined,
      budget: budget || undefined,
      currency: currency || undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      offerId: offerId || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create Campaign</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Campaign</DialogTitle>
            <DialogDescription>Launch a new marketing campaign.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="campaign-name">Name *</Label>
              <Input
                id="campaign-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="campaign-description">Description</Label>
              <Textarea
                id="campaign-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger>
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((ch) => (
                    <SelectItem key={ch.value} value={ch.value}>
                      {ch.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">UTM Parameters</legend>
              <div className="grid grid-cols-3 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="campaign-utm-source" className="text-xs">
                    Source
                  </Label>
                  <Input
                    id="campaign-utm-source"
                    value={utmSource}
                    onChange={(e) => setUtmSource(e.target.value)}
                    placeholder="google"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="campaign-utm-medium" className="text-xs">
                    Medium
                  </Label>
                  <Input
                    id="campaign-utm-medium"
                    value={utmMedium}
                    onChange={(e) => setUtmMedium(e.target.value)}
                    placeholder="cpc"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="campaign-utm-campaign" className="text-xs">
                    Campaign
                  </Label>
                  <Input
                    id="campaign-utm-campaign"
                    value={utmCampaign}
                    onChange={(e) => setUtmCampaign(e.target.value)}
                    placeholder="spring_sale"
                  />
                </div>
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="campaign-budget">Budget</Label>
                <Input
                  id="campaign-budget"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="e.g. 5000"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="campaign-currency">Currency</Label>
                <Input
                  id="campaign-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  placeholder="USD"
                  maxLength={3}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="campaign-start-date">Start Date</Label>
                <Input
                  id="campaign-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="campaign-end-date">End Date</Label>
                <Input
                  id="campaign-end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Linked Offer</Label>
              <Select value={offerId} onValueChange={setOfferId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select offer (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {(offersData?.items ?? []).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
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
            <Button type="submit" disabled={createMutation.isPending || !name}>
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

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

const CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'social', label: 'Social' },
  { value: 'paid_search', label: 'Paid Search' },
  { value: 'organic', label: 'Organic' },
  { value: 'referral', label: 'Referral' },
  { value: 'direct', label: 'Direct' },
  { value: 'other', label: 'Other' },
] as const

interface EditCampaignDialogProps {
  campaign: {
    id: string
    name: string
    description: string | null
    channel: string | null
    status: string
    utmSource: string | null
    utmMedium: string | null
    utmCampaign: string | null
    budget: string | null
    spend: string | null
    currency: string | null
    startDate: Date | string | null
    endDate: Date | string | null
    offerId: string | null
  }
  open: boolean
  onOpenChange: (open: boolean) => void
}

function toDateInputValue(date: Date | string | null): string {
  if (!date) return ''
  const d = new Date(date)
  return d.toISOString().slice(0, 10)
}

export function EditCampaignDialog({ campaign, open, onOpenChange }: EditCampaignDialogProps) {
  const [name, setName] = useState(campaign.name)
  const [description, setDescription] = useState(campaign.description ?? '')
  const [channel, setChannel] = useState(campaign.channel ?? '')
  const [status, setStatus] = useState(campaign.status)
  const [utmSource, setUtmSource] = useState(campaign.utmSource ?? '')
  const [utmMedium, setUtmMedium] = useState(campaign.utmMedium ?? '')
  const [utmCampaign, setUtmCampaign] = useState(campaign.utmCampaign ?? '')
  const [budget, setBudget] = useState(campaign.budget ?? '')
  const [spend, setSpend] = useState(campaign.spend ?? '')
  const [currency, setCurrency] = useState(campaign.currency ?? '')
  const [startDate, setStartDate] = useState(toDateInputValue(campaign.startDate))
  const [endDate, setEndDate] = useState(toDateInputValue(campaign.endDate))
  const [offerId, setOfferId] = useState(campaign.offerId ?? '')

  const offersRouter = trpc.offers as NonNullable<typeof trpc.offers>
  const listOffers = offersRouter.list as NonNullable<typeof offersRouter.list>
  const { data: offersData } = listOffers.useQuery(undefined, { retry: false })

  const utils = trpc.useUtils()
  const campaignsRouter = trpc.campaigns as NonNullable<typeof trpc.campaigns>
  const updateCampaign = campaignsRouter.update as NonNullable<typeof campaignsRouter.update>
  const campaignsUtils = utils.campaigns as NonNullable<typeof utils.campaigns>
  const listUtils = campaignsUtils.list as NonNullable<typeof campaignsUtils.list>
  const updateMutation = updateCampaign.useMutation({
    onSuccess: () => {
      listUtils.invalidate()
      onOpenChange(false)
    },
    onError: (err) => toast.error('Failed to update campaign', { description: err.message }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    updateMutation.mutate({
      id: campaign.id,
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
      status: status as 'draft' | 'active' | 'paused' | 'completed',
      utmSource: utmSource || undefined,
      utmMedium: utmMedium || undefined,
      utmCampaign: utmCampaign || undefined,
      budget: budget || undefined,
      spend: spend || undefined,
      currency: currency || undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      offerId: offerId || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Campaign</DialogTitle>
            <DialogDescription>Update campaign details and status.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-campaign-name">Name *</Label>
              <Input
                id="edit-campaign-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-campaign-description">Description</Label>
              <Textarea
                id="edit-campaign-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
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
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">UTM Parameters</legend>
              <div className="grid grid-cols-3 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="edit-campaign-utm-source" className="text-xs">
                    Source
                  </Label>
                  <Input
                    id="edit-campaign-utm-source"
                    value={utmSource}
                    onChange={(e) => setUtmSource(e.target.value)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="edit-campaign-utm-medium" className="text-xs">
                    Medium
                  </Label>
                  <Input
                    id="edit-campaign-utm-medium"
                    value={utmMedium}
                    onChange={(e) => setUtmMedium(e.target.value)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="edit-campaign-utm-campaign" className="text-xs">
                    Campaign
                  </Label>
                  <Input
                    id="edit-campaign-utm-campaign"
                    value={utmCampaign}
                    onChange={(e) => setUtmCampaign(e.target.value)}
                  />
                </div>
              </div>
            </fieldset>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-campaign-budget">Budget</Label>
                <Input
                  id="edit-campaign-budget"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-campaign-spend">Spend</Label>
                <Input
                  id="edit-campaign-spend"
                  value={spend}
                  onChange={(e) => setSpend(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-campaign-currency">Currency</Label>
                <Input
                  id="edit-campaign-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  maxLength={3}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-campaign-start-date">Start Date</Label>
                <Input
                  id="edit-campaign-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-campaign-end-date">End Date</Label>
                <Input
                  id="edit-campaign-end-date"
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
                  {(offersData?.items ?? []).map((o: { id: string; name: string }) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
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
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

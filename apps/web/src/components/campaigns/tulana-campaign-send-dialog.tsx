'use client'

import { Badge } from '@/components/ui/badge'
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
import { trpc } from '@/lib/trpc/client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

interface TulanaCampaignSendDialogProps {
  campaign: {
    id: string
    name: string
    skuKey: string | null
    status: string
  }
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TulanaCampaignSendDialog({
  campaign,
  open,
  onOpenChange,
}: TulanaCampaignSendDialogProps) {
  const [contactId, setContactId] = useState('')
  const utils = trpc.useUtils()
  const campaignsRouter = trpc.campaigns as NonNullable<typeof trpc.campaigns>
  const checkSendEligibility = campaignsRouter.checkSendEligibility as NonNullable<
    typeof campaignsRouter.checkSendEligibility
  >
  const attemptTulanaSend = campaignsRouter.attemptTulanaSend as NonNullable<
    typeof campaignsRouter.attemptTulanaSend
  >
  const campaignsUtils = utils.campaigns as NonNullable<typeof utils.campaigns>
  const listUtils = campaignsUtils.list as NonNullable<typeof campaignsUtils.list>

  const eligibilityQuery = checkSendEligibility.useQuery(
    { campaignId: campaign.id, contactId },
    { enabled: open && contactId.length >= 36 },
  )

  useEffect(() => {
    if (!open) {
      setContactId('')
    }
  }, [open])

  const sendMutation = attemptTulanaSend.useMutation({
    onSuccess: (result) => {
      listUtils.invalidate()
      onOpenChange(false)
      if (result.outcome === 'sent') {
        toast.success('Campaign dispatched', {
          description: `Delivered on ${result.channel} channel`,
        })
      } else {
        toast.warning('Send suppressed', {
          description: result.reasons.join(', '),
        })
      }
    },
    onError: (err) => toast.error('Send failed', { description: err.message }),
  })

  const eligibility = eligibilityQuery.data

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dispatch Tulana campaign</DialogTitle>
          <DialogDescription>
            Send <strong>{campaign.skuKey}</strong> to a contact. Consent and unsubscribe checks run
            before dispatch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="tulana-contact-id"
            >
              Contact ID
            </label>
            <Input
              id="tulana-contact-id"
              placeholder="Contact UUID"
              value={contactId}
              onChange={(e) => setContactId(e.target.value.trim())}
            />
          </div>

          {eligibilityQuery.isLoading && contactId && (
            <p className="text-sm text-muted-foreground">Checking consent...</p>
          )}

          {eligibility && (
            <div className="rounded-md border p-3 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant={eligibility.eligible ? 'success' : 'warning'}>
                  {eligibility.eligible ? 'Eligible' : 'Blocked'}
                </Badge>
                <span className="text-muted-foreground">Channel: {eligibility.channel}</span>
              </div>
              {!eligibility.eligible && (
                <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                  {eligibility.reasons.map((reason) => (
                    <li key={reason}>{reason.replaceAll('_', ' ')}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => sendMutation.mutate({ campaignId: campaign.id, contactId })}
            disabled={!contactId || sendMutation.isPending}
          >
            {sendMutation.isPending ? 'Dispatching...' : 'Dispatch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

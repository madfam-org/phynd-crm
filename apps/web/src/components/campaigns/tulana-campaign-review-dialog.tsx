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
import { trpc } from '@/lib/trpc/client'
import { toast } from 'sonner'

type TulanaMetadata = {
  proof_points?: { label: string; value: string; source_url?: string }[]
  guardrails?: { do_not_claim?: string[]; policy_state?: string }
  drafts?: { channel: string; locale?: string; body: string }[]
  campaign_type?: string
}

type DraftVariantRow = {
  id: string
  variantId: string | null
  format: string
  language: string | null
  subject: string | null
  preheader: string | null
  body: string
  cta: string | null
  claimKeysUsed: string[]
}

interface TulanaCampaignReviewDialogProps {
  campaign: {
    id: string
    name: string
    skuKey: string | null
    gaReadiness: string | null
    importSource: string | null
    orchestrator: string | null
    description: string | null
    tulanaMetadata: TulanaMetadata | Record<string, unknown> | null
  }
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TulanaCampaignReviewDialog({
  campaign,
  open,
  onOpenChange,
}: TulanaCampaignReviewDialogProps) {
  const utils = trpc.useUtils()
  const campaignsRouter = trpc.campaigns as NonNullable<typeof trpc.campaigns>
  const reviewTulanaImport = campaignsRouter.reviewTulanaImport as NonNullable<
    typeof campaignsRouter.reviewTulanaImport
  >
  const campaignsUtils = utils.campaigns as NonNullable<typeof utils.campaigns>
  const listUtils = campaignsUtils.list as NonNullable<typeof campaignsUtils.list>
  const listDraftVariants = campaignsRouter.listDraftVariants as NonNullable<
    typeof campaignsRouter.listDraftVariants
  >

  const metadata = (campaign.tulanaMetadata ?? {}) as TulanaMetadata
  const proofPoints = metadata.proof_points ?? []
  const doNotClaim = metadata.guardrails?.do_not_claim ?? []
  const drafts = metadata.drafts ?? []

  // Persisted Selva/Tulana copy variants (campaign_draft_variants) — carries
  // the claim_keys_used audit trail into this review step.
  const draftVariantsQuery = listDraftVariants.useQuery(
    { campaignId: campaign.id },
    { enabled: open },
  )
  const draftVariants = (draftVariantsQuery.data ?? []) as DraftVariantRow[]

  const reviewMutation = reviewTulanaImport.useMutation({
    onSuccess: (_data, variables) => {
      listUtils.invalidate()
      onOpenChange(false)
      toast.success(
        variables?.decision === 'approved' ? 'Campaign approved for send' : 'Campaign rejected',
      )
    },
    onError: (err) => toast.error('Review failed', { description: err.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review Tulana SKU campaign</DialogTitle>
          <DialogDescription>
            Verify proof points and guardrails before approving outreach for{' '}
            <strong>{campaign.skuKey}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-2">
            {campaign.importSource && <Badge variant="outline">{campaign.importSource}</Badge>}
            {campaign.orchestrator && <Badge variant="secondary">{campaign.orchestrator}</Badge>}
            {campaign.gaReadiness && (
              <Badge variant={campaign.gaReadiness === 'ready' ? 'success' : 'warning'}>
                GA: {campaign.gaReadiness.replace('_', ' ')}
              </Badge>
            )}
          </div>

          {campaign.description && (
            <div>
              <p className="font-medium text-foreground">Value proposition</p>
              <p className="text-muted-foreground">{campaign.description}</p>
            </div>
          )}

          {proofPoints.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Proof points</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                {proofPoints.map((point) => (
                  <li key={`${point.label}-${point.value}`}>
                    <span className="text-foreground">{point.label}:</span> {point.value}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {doNotClaim.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="font-medium text-amber-950 dark:text-amber-100">Do not claim</p>
              <ul className="mt-1 list-disc pl-5 text-amber-900 dark:text-amber-200">
                {doNotClaim.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {draftVariants.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Copy variants</p>
              <div className="mt-2 space-y-2">
                {draftVariants.map((variant) => (
                  <div key={variant.id} className="rounded-md border bg-muted/40 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {variant.format === 'legacy_string' ? 'legacy' : 'structured'}
                      </Badge>
                      {variant.language && <Badge variant="secondary">{variant.language}</Badge>}
                      {variant.variantId && (
                        <span className="text-xs text-muted-foreground">{variant.variantId}</span>
                      )}
                    </div>
                    {variant.subject && (
                      <p className="mt-2 text-xs">
                        <span className="font-medium uppercase text-muted-foreground">
                          Subject:{' '}
                        </span>
                        {variant.subject}
                      </p>
                    )}
                    {variant.preheader && (
                      <p className="mt-1 text-xs">
                        <span className="font-medium uppercase text-muted-foreground">
                          Preheader:{' '}
                        </span>
                        {variant.preheader}
                      </p>
                    )}
                    <p className="mt-2 whitespace-pre-wrap">{variant.body}</p>
                    {variant.cta && (
                      <p className="mt-1 text-xs">
                        <span className="font-medium uppercase text-muted-foreground">CTA: </span>
                        {variant.cta}
                      </p>
                    )}
                    {variant.claimKeysUsed.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs font-medium uppercase text-muted-foreground">
                          Claim keys used
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {variant.claimKeysUsed.map((key) => (
                            <Badge key={key} variant="outline" className="text-xs">
                              {key}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {drafts.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Draft copy</p>
              <div className="mt-2 space-y-2">
                {drafts.map((draft) => (
                  <div
                    key={`${draft.channel}-${draft.body.slice(0, 24)}`}
                    className="rounded-md border bg-muted/40 p-3"
                  >
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      {draft.channel}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{draft.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => reviewMutation.mutate({ id: campaign.id, decision: 'rejected' })}
            disabled={reviewMutation.isPending}
          >
            Reject
          </Button>
          <Button
            onClick={() => reviewMutation.mutate({ id: campaign.id, decision: 'approved' })}
            disabled={reviewMutation.isPending}
          >
            {reviewMutation.isPending ? 'Saving...' : 'Approve for send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

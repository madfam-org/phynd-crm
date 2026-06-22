'use client'

import { Button } from '@/components/ui/button'
import { trpc } from '@/lib/trpc/client'
import { FileCheck, Send } from 'lucide-react'
import { toast } from 'sonner'

interface PublishQuoteAndPortalButtonProps {
  engagementId: string
  disabled?: boolean
}

function getEmailRedacted(result: unknown): string {
  if (!result || typeof result !== 'object') return 'the client'
  const portal = (result as { portal?: { emailRedacted?: unknown } }).portal
  return typeof portal?.emailRedacted === 'string' ? portal.emailRedacted : 'the client'
}

export function PublishQuoteAndPortalButton({
  engagementId,
  disabled,
}: PublishQuoteAndPortalButtonProps) {
  const engagementsRouter = trpc.engagements as NonNullable<typeof trpc.engagements>
  const publishAndSend = engagementsRouter.publishQuoteAndSendPortalLink as NonNullable<
    typeof engagementsRouter.publishQuoteAndSendPortalLink
  >

  const utils = trpc.useUtils()
  const engagementsUtils = utils.engagements as NonNullable<typeof utils.engagements>
  const getTimelineUtils = engagementsUtils.getTimeline as NonNullable<
    typeof engagementsUtils.getTimeline
  >
  const listArtifactsUtils = engagementsUtils.listArtifacts as NonNullable<
    typeof engagementsUtils.listArtifacts
  >

  const mutation = publishAndSend.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        getTimelineUtils.invalidate({ engagementId }),
        listArtifactsUtils.invalidate({ engagementId }),
      ])
      const description = result.alreadyPublished
        ? `Quote ${result.quoteNumber} was already sent. Portal link emailed to ${getEmailRedacted(result)}.`
        : `Quote ${result.quoteNumber} published to the portal and link sent to ${getEmailRedacted(result)}.`
      toast.success('Client notified', { description })
    },
    onError: (err) =>
      toast.error('Could not publish quote and send portal link', { description: err.message }),
  })

  return (
    <Button
      size="sm"
      disabled={disabled || mutation.isPending}
      data-testid="publish-quote-portal-btn"
      onClick={() => mutation.mutate({ engagementId })}
    >
      <FileCheck className="mr-2 h-4 w-4" aria-hidden="true" />
      <Send className="mr-2 h-3.5 w-3.5 opacity-70" aria-hidden="true" />
      {mutation.isPending ? 'Sending...' : 'Send Quote & Portal Link'}
    </Button>
  )
}

'use client'

import { Button } from '@/components/ui/button'
import { trpc } from '@/lib/trpc/client'
import { Send } from 'lucide-react'
import { toast } from 'sonner'

interface SendPortalLinkButtonProps {
  engagementId: string
  disabled?: boolean
}

function getEmailRedacted(result: unknown): string {
  if (!result || typeof result !== 'object') return 'the client'
  const candidate = result as { emailRedacted?: unknown }
  return typeof candidate.emailRedacted === 'string' ? candidate.emailRedacted : 'the client'
}

export function SendPortalLinkButton({ engagementId, disabled }: SendPortalLinkButtonProps) {
  const engagementsRouter = trpc.engagements as NonNullable<typeof trpc.engagements>
  const sendPortalLink = engagementsRouter.sendPortalLink as NonNullable<
    typeof engagementsRouter.sendPortalLink
  >
  const sendMutation = sendPortalLink.useMutation({
    onSuccess: (result) => {
      toast.success('Portal link sent', {
        description: `Magic-link email dispatched via Janua to ${getEmailRedacted(result)}.`,
      })
    },
    onError: (err) => toast.error('Failed to send portal link', { description: err.message }),
  })

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || sendMutation.isPending}
      onClick={() => sendMutation.mutate({ engagementId })}
    >
      <Send className="mr-2 h-4 w-4" aria-hidden="true" />
      {sendMutation.isPending ? 'Sending...' : 'Send Portal Link'}
    </Button>
  )
}

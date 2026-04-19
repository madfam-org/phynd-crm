'use client'

import { Button } from '@/components/ui/button'
import { trpc } from '@/lib/trpc/client'
import { Send } from 'lucide-react'
import { toast } from 'sonner'

interface SendPortalLinkButtonProps {
  engagementId: string
  disabled?: boolean
}

export function SendPortalLinkButton({ engagementId, disabled }: SendPortalLinkButtonProps) {
  const sendMutation = trpc.engagements.sendPortalLink.useMutation({
    onSuccess: (result) => {
      toast.success('Portal link sent', {
        description: `Magic-link email dispatched via Janua to ${result.emailRedacted}.`,
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

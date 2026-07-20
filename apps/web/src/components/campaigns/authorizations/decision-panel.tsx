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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { trpc } from '@/lib/trpc/client'
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

interface DecisionPanelProps {
  authorizationId: string
  campaignId: string
  campaignName: string
  /** Live campaign content no longer matches this snapshot — cannot authorize. */
  stale: boolean
}

/**
 * The owner's decision controls. Authorize asks for one deliberate
 * confirmation (this is the money gate); Reject requires a written reason —
 * both land in the immutable authorization ledger.
 */
export function DecisionPanel({
  authorizationId,
  campaignId,
  campaignName,
  stale,
}: DecisionPanelProps) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState<'authorize' | 'reject' | null>(null)
  const [note, setNote] = useState('')

  const decideMutation = trpc.campaignAuthorizations.decide.useMutation({
    onSuccess: (record) => {
      setConfirmOpen(null)
      toast.success(
        record.status === 'authorized'
          ? 'Campaign authorized for send'
          : 'Campaign rejected — the send path stays blocked',
      )
      router.refresh()
    },
    onError: (err) => toast.error('Decision failed', { description: err.message }),
  })

  const requestMutation = trpc.campaignAuthorizations.request.useMutation({
    onSuccess: (record) => {
      toast.success('Fresh authorization request created from current content')
      router.replace(`/campaigns/authorizations/${record.id}`)
      router.refresh()
    },
    onError: (err) => toast.error('Could not create request', { description: err.message }),
  })

  const trimmedNote = note.trim()
  const busy = decideMutation.isPending || requestMutation.isPending

  if (stale) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The campaign was edited after this snapshot was taken, so this request can no longer be
          authorized. Create a fresh request to review the current content.
        </p>
        <Button
          className="w-full"
          disabled={busy}
          onClick={() => requestMutation.mutate({ campaignId })}
        >
          {requestMutation.isPending ? 'Creating…' : 'Request fresh review'}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Button className="w-full" disabled={busy} onClick={() => setConfirmOpen('authorize')}>
        <ShieldCheck className="mr-2 h-4 w-4" />
        Authorize send
      </Button>
      <Button
        variant="outline"
        className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={busy}
        onClick={() => setConfirmOpen('reject')}
      >
        <XCircle className="mr-2 h-4 w-4" />
        Reject
      </Button>
      <p className="pt-1 text-xs text-muted-foreground">
        Your identity, the timestamp, and this exact snapshot are recorded in the authorization
        ledger. Any later edit to the campaign voids the authorization automatically.
      </p>

      <Dialog
        open={confirmOpen !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmOpen(null)
            setNote('')
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmOpen === 'authorize' ? 'Authorize this campaign?' : 'Reject this campaign?'}
            </DialogTitle>
            <DialogDescription>
              {confirmOpen === 'authorize' ? (
                <>
                  <strong>{campaignName}</strong> becomes sendable to consented, non-suppressed
                  contacts exactly as shown in this review. This is the final human gate before
                  outbound email.
                </>
              ) : (
                <>
                  <strong>{campaignName}</strong> is parked and stays unsendable. A written reason
                  is required and lands in the audit ledger.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="decision-note">
              {confirmOpen === 'authorize' ? 'Note (optional)' : 'Reason for rejection'}
            </Label>
            <Textarea
              id="decision-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                confirmOpen === 'authorize'
                  ? 'Context for the record…'
                  : 'What must change before this can be authorized?'
              }
              rows={3}
              maxLength={2000}
            />
            {confirmOpen === 'reject' && !trimmedNote && (
              <p className="text-xs text-muted-foreground">A reason is required to reject.</p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" disabled={busy} onClick={() => setConfirmOpen(null)}>
              Cancel
            </Button>
            {confirmOpen === 'authorize' ? (
              <Button
                disabled={busy}
                onClick={() =>
                  decideMutation.mutate({
                    id: authorizationId,
                    decision: 'authorized',
                    ...(trimmedNote ? { note: trimmedNote } : {}),
                  })
                }
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {decideMutation.isPending ? 'Recording…' : 'Confirm authorization'}
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={busy || !trimmedNote}
                onClick={() =>
                  decideMutation.mutate({
                    id: authorizationId,
                    decision: 'rejected',
                    note: trimmedNote,
                  })
                }
              >
                {decideMutation.isPending ? 'Recording…' : 'Confirm rejection'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

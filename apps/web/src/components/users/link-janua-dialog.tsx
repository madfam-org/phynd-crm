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
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useState } from 'react'
import { toast } from 'sonner'

type MeOutput = inferRouterOutputs<AppRouter>['users']['me']

interface LinkJanuaDialogProps {
  user: { id: string; email: string; name: string | null }
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Links a CRM user to a Janua subject (the Janua user id, OIDC `sub`). Phynd has
 * no safe Janua lookup by email, so the admin pastes the subject. An unlinked
 * user can read their own subject in the notifications menu; an unlinked admin
 * is offered their own subject here (`users.me`).
 */
export function LinkJanuaDialog({ user, open, onOpenChange }: LinkJanuaDialogProps) {
  const [januaSub, setJanuaSub] = useState('')

  const utils = trpc.useUtils()
  const usersRouter = trpc.users as NonNullable<typeof trpc.users>
  const linkJanua = usersRouter.linkJanua as NonNullable<typeof usersRouter.linkJanua>
  const meQuery = usersRouter.me as NonNullable<typeof usersRouter.me>
  const { data: meData } = meQuery.useQuery(undefined, { enabled: open, retry: false })
  const me = meData as MeOutput | undefined
  const usersUtils = utils.users as NonNullable<typeof utils.users>
  const listUsersUtils = usersUtils.list as NonNullable<typeof usersUtils.list>
  const linkMutation = linkJanua.useMutation({
    onSuccess: () => {
      listUsersUtils.invalidate()
      onOpenChange(false)
      setJanuaSub('')
      toast.success('Janua identity linked')
    },
    onError: (err) => toast.error('Failed to link Janua identity', { description: err.message }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    linkMutation.mutate({ id: user.id, januaSub: januaSub.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Link Janua identity</DialogTitle>
            <DialogDescription>
              Signing in with this Janua identity will act as {user.name ?? user.email}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="link-janua-sub">Janua subject (user id)</Label>
              <Input
                id="link-janua-sub"
                value={januaSub}
                onChange={(e) => setJanuaSub(e.target.value)}
                placeholder="e.g. 5b0f2c1e-7a7d-4c1e-9d55-2f3b8f6a9c01"
                className="font-mono"
                autoComplete="off"
                required
              />
            </div>
            {me?.januaSub && !me.linked && (
              <p className="text-xs text-muted-foreground">
                Your own Janua subject is <span className="font-mono">{me.januaSub}</span>{' '}
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => setJanuaSub(me.januaSub ?? '')}
                >
                  Use mine
                </Button>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={linkMutation.isPending || !januaSub.trim()}>
              {linkMutation.isPending ? 'Linking...' : 'Link'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

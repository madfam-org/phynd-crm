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
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useState } from 'react'
import { toast } from 'sonner'

type UsersListOutput = inferRouterOutputs<AppRouter>['users']['list']
type UserOption = UsersListOutput['items'][number]

interface EditLeadDialogProps {
  lead: { id: string; status: string; score: number | null; ownerId: string | null }
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditLeadDialog({ lead, open, onOpenChange }: EditLeadDialogProps) {
  const [status, setStatus] = useState(lead.status)
  const [score, setScore] = useState(String(lead.score ?? ''))
  const [ownerId, setOwnerId] = useState(lead.ownerId ?? '')

  const usersRouter = trpc.users as NonNullable<typeof trpc.users>
  const leadsRouter = trpc.leads as NonNullable<typeof trpc.leads>
  const listUsers = usersRouter.list as NonNullable<typeof usersRouter.list>
  const updateLead = leadsRouter.update as NonNullable<typeof leadsRouter.update>
  const { data: usersData } = listUsers.useQuery(undefined, { retry: false })
  const users = (usersData as UsersListOutput | undefined)?.items ?? []

  const utils = trpc.useUtils()
  const leadsUtils = utils.leads as NonNullable<typeof utils.leads>
  const listLeadsUtils = leadsUtils.list as NonNullable<typeof leadsUtils.list>
  const updateMutation = updateLead.useMutation({
    onSuccess: () => {
      listLeadsUtils.invalidate()
      onOpenChange(false)
    },
    onError: (err) => toast.error('Failed to update lead', { description: err.message }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    updateMutation.mutate({
      id: lead.id,
      status: status as 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted',
      score: score ? Number(score) : undefined,
      ownerId: ownerId || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Lead</DialogTitle>
            <DialogDescription>Update lead status, score, and owner.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                  <SelectItem value="qualified">Qualified</SelectItem>
                  <SelectItem value="unqualified">Unqualified</SelectItem>
                  <SelectItem value="converted">Converted</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-score">Score (0-100)</Label>
              <Input
                id="edit-score"
                type="number"
                min={0}
                max={100}
                value={score}
                onChange={(e) => setScore(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select owner" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {users.map((u: UserOption) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name ?? u.email}
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

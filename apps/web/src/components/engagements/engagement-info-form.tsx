'use client'

import { Button } from '@/components/ui/button'
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
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useState } from 'react'
import { toast } from 'sonner'

const ENGAGEMENT_STATUSES = ['active', 'completed', 'paused', 'cancelled'] as const
type UsersListOutput = inferRouterOutputs<AppRouter>['users']['list']
type UserOption = UsersListOutput['items'][number]

interface EngagementInfoFormProps {
  engagement: {
    id: string
    projectName: string
    description: string | null
    status: string
    ownerId: string | null
  }
}

export function EngagementInfoForm({ engagement }: EngagementInfoFormProps) {
  const [projectName, setProjectName] = useState(engagement.projectName)
  const [description, setDescription] = useState(engagement.description ?? '')
  const [status, setStatus] = useState(engagement.status)
  const [ownerId, setOwnerId] = useState(engagement.ownerId ?? '')

  const usersRouter = trpc.users as NonNullable<typeof trpc.users>
  const engagementsRouter = trpc.engagements as NonNullable<typeof trpc.engagements>
  const listUsers = usersRouter.list as NonNullable<typeof usersRouter.list>
  const updateEngagement = engagementsRouter.update as NonNullable<typeof engagementsRouter.update>
  const { data: usersData } = listUsers.useQuery(undefined, { retry: false })
  const users = (usersData as UsersListOutput | undefined)?.items ?? []

  const utils = trpc.useUtils()
  const engagementsUtils = utils.engagements as NonNullable<typeof utils.engagements>
  const listEngagementsUtils = engagementsUtils.list as NonNullable<typeof engagementsUtils.list>
  const getByIdUtils = engagementsUtils.getById as NonNullable<typeof engagementsUtils.getById>
  const updateMutation = updateEngagement.useMutation({
    onSuccess: () => {
      listEngagementsUtils.invalidate()
      getByIdUtils.invalidate({ id: engagement.id })
      toast.success('Engagement updated')
    },
    onError: (err) => toast.error('Failed to update engagement', { description: err.message }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!projectName.trim()) return
    updateMutation.mutate({
      id: engagement.id,
      projectName: projectName.trim(),
      description: description.trim() || undefined,
      status,
      ownerId: ownerId || undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="info-project-name">Project Name *</Label>
        <Input
          id="info-project-name"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          maxLength={255}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="info-description">Description</Label>
        <Textarea
          id="info-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={4}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              {ENGAGEMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      <div className="flex justify-end">
        <Button type="submit" disabled={updateMutation.isPending || !projectName.trim()}>
          {updateMutation.isPending ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </form>
  )
}

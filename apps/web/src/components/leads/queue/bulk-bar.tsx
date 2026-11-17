'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { ChevronDown, X } from 'lucide-react'
import { toast } from 'sonner'
import { type LeadAssigneeOption, assigneeLabel } from '../assign-lead'
import { COPY, LEAD_STATUSES, LEAD_STATUS_LABEL } from '../copy'

type TagsOutput = inferRouterOutputs<AppRouter>['tags']['list']

/** Actions on the selected leads: assign, change status, tag. */
export function BulkBar({
  selectedIds,
  assignees,
  canAssign,
  onDone,
  onClear,
}: {
  selectedIds: string[]
  assignees: LeadAssigneeOption[]
  canAssign: boolean
  onDone: () => void
  onClear: () => void
}) {
  const leadsRouter = trpc.leads as NonNullable<typeof trpc.leads>
  const tagsRouter = trpc.tags as NonNullable<typeof trpc.tags>
  const bulkAssign = (
    leadsRouter.bulkAssign as NonNullable<typeof leadsRouter.bulkAssign>
  ).useMutation({
    onSuccess: (changed) => {
      toast.success(COPY.bulkAssigned(Number(changed)))
      onDone()
    },
    onError: (err) => toast.error(COPY.reassignFailed, { description: err.message }),
  })
  const bulkStatus = (
    leadsRouter.bulkUpdateStatus as NonNullable<typeof leadsRouter.bulkUpdateStatus>
  ).useMutation({
    onSuccess: () => {
      toast.success(COPY.statusChanged)
      onDone()
    },
    onError: (err) => toast.error(COPY.statusFailed, { description: err.message }),
  })
  const listTags = tagsRouter.list as NonNullable<typeof tagsRouter.list>
  const { data: tagsData } = listTags.useQuery(undefined, { retry: false })
  const tags = (tagsData as TagsOutput | undefined)?.items ?? []
  const addTag = (
    tagsRouter.addToEntity as NonNullable<typeof tagsRouter.addToEntity>
  ).useMutation()

  async function tagAll(tagId: string) {
    try {
      await Promise.all(
        selectedIds.map((id) => addTag.mutateAsync({ tagId, entityType: 'lead', entityId: id })),
      )
      toast.success(COPY.tagged)
      onDone()
    } catch (err) {
      toast.error(COPY.tagFailed, { description: err instanceof Error ? err.message : undefined })
    }
  }

  const busy = bulkAssign.isPending || bulkStatus.isPending || addTag.isPending
  return (
    <section
      aria-label={COPY.selected(selectedIds.length)}
      className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 shadow-[0_4px_16px_-4px_rgb(0_0_0/0.12)]"
    >
      <span className="text-sm font-medium tabular-nums">{COPY.selected(selectedIds.length)}</span>
      <span aria-hidden className="mx-1 h-5 w-px bg-border" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy || !canAssign}>
            {COPY.assignTo} <ChevronDown aria-hidden className="ml-1 h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {assignees.length === 0 ? (
            <DropdownMenuItem disabled>{COPY.noAssignees}</DropdownMenuItem>
          ) : (
            assignees.map((user) => (
              <DropdownMenuItem
                key={user.id}
                onSelect={() => bulkAssign.mutate({ ids: selectedIds, ownerId: user.id })}
              >
                {assigneeLabel(user)}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy}>
            {COPY.changeStatus} <ChevronDown aria-hidden className="ml-1 h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {LEAD_STATUSES.map((status) => (
            <DropdownMenuItem
              key={status}
              onSelect={() => bulkStatus.mutate({ ids: selectedIds, status })}
            >
              {LEAD_STATUS_LABEL[status]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy}>
            {COPY.addTag} <ChevronDown aria-hidden className="ml-1 h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
          {tags.length === 0 ? (
            <DropdownMenuItem disabled>{COPY.noTags}</DropdownMenuItem>
          ) : (
            tags.map((tag) => (
              <DropdownMenuItem key={tag.id} onSelect={() => void tagAll(tag.id)}>
                {tag.name}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        onClick={onClear}
        aria-label={COPY.clearSelection}
      >
        <X aria-hidden className="h-4 w-4" />
      </Button>
    </section>
  )
}

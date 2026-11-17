'use client'

import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
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
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

type AssigneesOutput = inferRouterOutputs<AppRouter>['leads']['assignees']
export type LeadAssigneeOption = AssigneesOutput[number]

/** Staff a lead can be assigned to (admin, manager, sales rep with a linked account). */
export function useLeadAssignees(): LeadAssigneeOption[] {
  const leadsRouter = trpc.leads as NonNullable<typeof trpc.leads>
  const assignees = leadsRouter.assignees as NonNullable<typeof leadsRouter.assignees>
  const { data } = assignees.useQuery(undefined, { retry: false })
  return (data as AssigneesOutput | undefined) ?? []
}

/** The assign mutation; refreshes the lead lists (and the server page) on success. */
export function useAssignLead() {
  const router = useRouter()
  const leadsRouter = trpc.leads as NonNullable<typeof trpc.leads>
  const assign = leadsRouter.assign as NonNullable<typeof leadsRouter.assign>
  const utils = trpc.useUtils()
  const leadsUtils = utils.leads as NonNullable<typeof utils.leads>
  const listUtils = leadsUtils.list as NonNullable<typeof leadsUtils.list>
  return assign.useMutation({
    onSuccess: () => {
      void listUtils.invalidate()
      router.refresh()
      toast.success('Lead reassigned')
    },
    onError: (err) => toast.error('Could not reassign the lead', { description: err.message }),
  })
}

export function assigneeLabel(user: { name: string | null; email: string }): string {
  return user.name ?? user.email
}

/** "Assign to…" submenu for a row's actions menu. */
export function AssignLeadSubmenu({
  leadId,
  ownerId,
  assignees,
  onAssign,
}: {
  leadId: string
  ownerId: string | null
  assignees: LeadAssigneeOption[]
  onAssign: (input: { id: string; ownerId: string }) => void
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Assign to…</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {assignees.length === 0 ? (
          <DropdownMenuItem disabled>No staff to assign</DropdownMenuItem>
        ) : (
          assignees.map((user) => (
            <DropdownMenuItem
              key={user.id}
              disabled={user.id === ownerId}
              onClick={() => onAssign({ id: leadId, ownerId: user.id })}
            >
              {assigneeLabel(user)}
              {user.id === ownerId ? ' (owner)' : ''}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** Owner picker on the lead page: choosing someone reassigns the lead at once. */
export function LeadAssignControl({
  leadId,
  ownerId,
}: {
  leadId: string
  ownerId: string | null
}) {
  const assignees = useLeadAssignees()
  const mutation = useAssignLead()
  return (
    <Select
      value={ownerId ?? ''}
      onValueChange={(value) => {
        if (value && value !== ownerId) mutation.mutate({ id: leadId, ownerId: value })
      }}
      disabled={mutation.isPending}
    >
      <SelectTrigger className="w-[220px]" aria-label="Assign to">
        <SelectValue placeholder="Assign to…" />
      </SelectTrigger>
      <SelectContent>
        {assignees.map((user) => (
          <SelectItem key={user.id} value={user.id}>
            {assigneeLabel(user)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

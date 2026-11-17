'use client'

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
import { COPY } from './copy'

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
  const queueUtils = leadsUtils.queue as NonNullable<typeof leadsUtils.queue>
  const countsUtils = leadsUtils.queueCounts as NonNullable<typeof leadsUtils.queueCounts>
  return assign.useMutation({
    onSuccess: () => {
      void queueUtils.invalidate()
      void countsUtils.invalidate()
      router.refresh()
      toast.success(COPY.reassigned)
    },
    onError: (err) => toast.error(COPY.reassignFailed, { description: err.message }),
  })
}

export function assigneeLabel(user: { name: string | null; email: string }): string {
  return user.name ?? user.email
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
      <SelectTrigger className="w-full max-w-[240px]" aria-label={COPY.assignTo}>
        <SelectValue placeholder={COPY.assignTo} />
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

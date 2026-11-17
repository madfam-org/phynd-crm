'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Check, ChevronDown } from 'lucide-react'
import { type LeadAssigneeOption, assigneeLabel } from '../assign-lead'
import { COPY } from '../copy'
import { OwnerAvatar } from './lead-queue-parts'

/**
 * The owner cell: avatar and name, and «Asignar a…» in one control. `open` is
 * controlled so the `a` shortcut opens it on the focused row.
 */
export function OwnerMenu({
  leadName,
  owner,
  assignees,
  open,
  onOpenChange,
  onAssign,
  disabled,
}: {
  leadName: string
  owner: { id: string; name: string | null; email: string } | null
  assignees: LeadAssigneeOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onAssign: (ownerId: string) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={`${COPY.assignTo} ${leadName}. ${COPY.owner}: ${owner ? (owner.name ?? owner.email) : COPY.unassigned}`}
        className="group inline-flex max-w-full items-center gap-1 rounded-md px-1 py-1 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        onClick={(event) => event.stopPropagation()}
      >
        <OwnerAvatar owner={owner} showName />
        <ChevronDown
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-meta opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-60"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuLabel className="text-xs font-medium text-meta">
          {COPY.assignTo}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {assignees.length === 0 ? (
          <DropdownMenuItem disabled>{COPY.noAssignees}</DropdownMenuItem>
        ) : (
          assignees.map((user) => {
            const current = user.id === owner?.id
            return (
              <DropdownMenuItem
                key={user.id}
                disabled={current}
                onSelect={() => onAssign(user.id)}
                className="gap-2"
              >
                <OwnerAvatar owner={user} />
                <span className="truncate">{assigneeLabel(user)}</span>
                {current && <Check aria-label="Responsable actual" className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

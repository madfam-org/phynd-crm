'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { leadChannel } from '../channel'
import { COPY } from '../copy'
import { slaState, timeAgo } from '../sla'
import { DeadlineClock, MaskedText, StatusLabel, TierMark, WaitlistNote } from './lead-queue-parts'
import { type QueueRowsProps, leadName } from './lead-queue-table'
import { OwnerMenu } from './owner-menu'

/** Phone layout (< md): the same rows as stacked cards, same order, same marks. */
export function LeadQueueCards(props: QueueRowsProps) {
  const { rows, now, selected } = props
  return (
    <ul className="space-y-2 md:hidden">
      {rows.map((row) => {
        const name = leadName(row)
        const overdue = slaState(row.firstContact, now).kind === 'overdue'
        return (
          <li
            key={row.id}
            className={cn(
              'rounded-lg border border-border p-3',
              overdue && 'bg-danger-row',
              selected.has(row.id) && 'bg-selection/60',
            )}
          >
            <div className="flex items-start gap-3">
              <Checkbox
                className="mt-1"
                checked={selected.has(row.id)}
                onCheckedChange={() => props.onToggle(row.id)}
                aria-label={COPY.selectRow(name)}
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/leads/${row.id}`}
                    className="min-w-0 truncate font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                  >
                    <MaskedText value={name} />
                  </Link>
                  <TierMark tier={row.tier} score={row.score} breakdown={row.breakdown} />
                </div>
                {row.messagePreview && (
                  <p className="line-clamp-2 text-sm text-meta">
                    <MaskedText value={`“${row.messagePreview}”`} />
                  </p>
                )}
                <WaitlistNote intent={row.intent} />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-meta">
                  <DeadlineClock task={row.firstContact} now={now} />
                  <span>{leadChannel(row.source).label}</span>
                  <StatusLabel status={row.status} />
                  <span className="tabular-nums" suppressHydrationWarning>
                    {timeAgo(row.lastActivityAt ?? row.createdAt, now)}
                  </span>
                </div>
                <OwnerMenu
                  leadName={name}
                  owner={row.owner}
                  assignees={props.assignees}
                  open={props.assignOpenFor === row.id}
                  onOpenChange={(open) => props.onAssignOpenChange(open ? row.id : null)}
                  onAssign={(ownerId) => props.onAssign(row.id, ownerId)}
                  disabled={!props.canAssign}
                />
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

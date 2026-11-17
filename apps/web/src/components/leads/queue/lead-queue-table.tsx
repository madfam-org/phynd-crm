'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import Link from 'next/link'
import type { LeadAssigneeOption } from '../assign-lead'
import { COPY } from '../copy'
import { slaState, timeAgo } from '../sla'
import {
  ChannelLabel,
  DeadlineClock,
  MaskedText,
  StatusLabel,
  TierMark,
  WaitlistNote,
} from './lead-queue-parts'
import { OwnerMenu } from './owner-menu'

export type QueueRow = inferRouterOutputs<AppRouter>['leads']['queue']['items'][number]

export interface QueueRowsProps {
  rows: QueueRow[]
  now: Date
  focusedIndex: number
  onFocusRow: (index: number) => void
  selected: ReadonlySet<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
  assignees: LeadAssigneeOption[]
  assignOpenFor: string | null
  onAssignOpenChange: (id: string | null) => void
  onAssign: (id: string, ownerId: string) => void
  canAssign: boolean
}

export function leadName(row: QueueRow): string {
  return row.contact?.name || `Lead ${row.id.slice(0, 8)}`
}

/** Desktop layout (≥ md): a dense table ordered by urgency. */
export function LeadQueueTable(props: QueueRowsProps) {
  const { rows, now, selected } = props
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))
  return (
    <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <caption className="sr-only">{COPY.keyboardHint}</caption>
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium text-meta">
            <th scope="col" className="w-10 px-3 py-2.5">
              <Checkbox
                checked={allSelected}
                onCheckedChange={props.onToggleAll}
                aria-label={COPY.selectAll}
              />
            </th>
            <th scope="col" className="w-40 px-3 py-2.5 font-medium">
              {COPY.firstContact}
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              {COPY.lead}
            </th>
            <th scope="col" className="w-20 px-3 py-2.5 font-medium">
              {COPY.tier}
            </th>
            <th scope="col" className="w-36 px-3 py-2.5 font-medium">
              {COPY.channel}
            </th>
            <th scope="col" className="w-48 px-3 py-2.5 font-medium">
              {COPY.owner}
            </th>
            <th scope="col" className="w-28 px-3 py-2.5 font-medium">
              {COPY.lastActivity}
            </th>
            <th scope="col" className="w-28 px-3 py-2.5 font-medium">
              {COPY.status}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const name = leadName(row)
            const overdue = slaState(row.firstContact, now).kind === 'overdue'
            const focused = index === props.focusedIndex
            return (
              <tr
                key={row.id}
                data-lead-row={index}
                tabIndex={focused ? 0 : -1}
                aria-selected={selected.has(row.id)}
                onFocus={() => props.onFocusRow(index)}
                className={cn(
                  'border-b border-border align-top transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  overdue && 'bg-danger-row',
                  selected.has(row.id) ? 'bg-selection/60' : 'hover:bg-muted/40',
                )}
              >
                <td className="px-3 py-3">
                  <Checkbox
                    checked={selected.has(row.id)}
                    onCheckedChange={() => props.onToggle(row.id)}
                    aria-label={COPY.selectRow(name)}
                    tabIndex={-1}
                  />
                </td>
                <td className="px-3 py-3">
                  <DeadlineClock task={row.firstContact} now={now} />
                </td>
                <td className="max-w-0 px-3 py-3">
                  <Link
                    href={`/leads/${row.id}`}
                    tabIndex={-1}
                    className="block truncate font-medium text-foreground hover:underline focus-visible:underline"
                    aria-label={COPY.openLead(name)}
                  >
                    <MaskedText value={name} />
                  </Link>
                  <p className="truncate text-xs text-meta">
                    {row.contact?.company ? <MaskedText value={row.contact.company} /> : null}
                    {row.contact?.company && row.messagePreview ? ' · ' : null}
                    {row.messagePreview ? (
                      <MaskedText value={`“${row.messagePreview}”`} />
                    ) : (
                      !row.contact?.company && COPY.noMessage
                    )}
                  </p>
                  <WaitlistNote intent={row.intent} />
                </td>
                <td className="px-3 py-3">
                  <TierMark tier={row.tier} score={row.score} breakdown={row.breakdown} />
                </td>
                <td className="max-w-0 px-3 py-3">
                  <ChannelLabel source={row.source} />
                </td>
                <td className="max-w-0 px-2 py-2">
                  <OwnerMenu
                    leadName={name}
                    owner={row.owner}
                    assignees={props.assignees}
                    open={props.assignOpenFor === row.id}
                    onOpenChange={(open) => props.onAssignOpenChange(open ? row.id : null)}
                    onAssign={(ownerId) => props.onAssign(row.id, ownerId)}
                    disabled={!props.canAssign}
                  />
                </td>
                <td
                  className="whitespace-nowrap px-3 py-3 text-meta tabular-nums"
                  suppressHydrationWarning
                >
                  {timeAgo(row.lastActivityAt ?? row.createdAt, now)}
                </td>
                <td className="px-3 py-3">
                  <StatusLabel status={row.status} />
                  {row.tags.length > 0 && (
                    <p className="mt-1 truncate text-xs text-meta">
                      {row.tags.map((tag) => tag.name).join(', ')}
                    </p>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

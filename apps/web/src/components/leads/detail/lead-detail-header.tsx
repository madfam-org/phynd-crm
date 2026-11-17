import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { LeadAssignControl } from '../assign-lead'
import { leadChannel } from '../channel'
import { COPY, LEAD_STATUS_LABEL } from '../copy'
import { DeadlineClock, MaskedText, TierMark, WaitlistNote } from '../queue/lead-queue-parts'
import { LeadActions } from './lead-actions'

export type Workspace = NonNullable<inferRouterOutputs<AppRouter>['leads']['workspace']>

/**
 * Who the lead is, how urgent it is, who owns it and what happens next. The
 * deadline clock repeats the queue's signature next to the next step.
 */
export function LeadDetailHeader({
  workspace,
  canAssign,
}: {
  workspace: Workspace
  canAssign: boolean
}) {
  const { lead, contact, owner, firstContact, tasks } = workspace
  const name = contact?.name || `Lead ${lead.id.slice(0, 8)}`
  const channel = leadChannel(lead.source)
  const nextTask = tasks[0] ?? null
  return (
    <header className="space-y-4">
      <Link
        href="/leads"
        className="inline-flex items-center gap-1 text-sm text-meta hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <ArrowLeft aria-hidden className="h-4 w-4" /> Leads
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">
            <MaskedText value={name} />
          </h1>
          <p className="text-sm text-meta">
            {contact?.company ? (
              <>
                <MaskedText value={contact.company} /> ·{' '}
              </>
            ) : null}
            {channel.label}
            {channel.detail ? ` · ${channel.detail}` : ''}
          </p>
          <WaitlistNote intent={lead.attribution?.intent} />
        </div>
        <div className="flex items-center gap-2">
          <TierMark tier={lead.tier} score={lead.score} breakdown={workspace.breakdown} size="lg" />
          <LeadActions
            lead={{
              id: lead.id,
              status: lead.status,
              score: lead.score,
              ownerId: owner?.id ?? null,
            }}
            label={name}
          />
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <dt className="text-xs font-medium text-meta">{COPY.owner}</dt>
          <dd>
            {canAssign ? (
              <LeadAssignControl leadId={lead.id} ownerId={owner?.id ?? null} />
            ) : (
              <span className="text-sm">
                {owner ? (owner.name ?? owner.email) : COPY.unassigned}
              </span>
            )}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs font-medium text-meta">{COPY.status} · Etapa</dt>
          <dd className="text-sm">
            {LEAD_STATUS_LABEL[lead.status] ?? lead.status}
            {lead.stageName ? <span className="text-meta"> · {lead.stageName}</span> : null}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs font-medium text-meta">{COPY.firstContact}</dt>
          <dd>
            <DeadlineClock task={firstContact} />
          </dd>
        </div>
        <div className="min-w-0 space-y-1">
          <dt className="text-xs font-medium text-meta">Siguiente paso</dt>
          <dd className="truncate text-sm">
            {nextTask ? nextTask.title : <span className="text-meta">Sin tareas abiertas</span>}
          </dd>
        </div>
      </dl>
    </header>
  )
}

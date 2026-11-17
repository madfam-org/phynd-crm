'use client'

import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import Link from 'next/link'
import { COPY, VIEW_LABEL } from '../copy'
import {
  LEAD_QUEUE_VIEWS,
  LEAD_TIER_FILTERS,
  type LeadQueueView,
  type LeadsFilters,
  leadsHref,
} from '../lead-filters'

// The saved views as URL-addressable tabs, plus the tier chips that combine
// with any view. Links, not buttons: every state is a shareable URL.

const VIEW_ORDER: LeadQueueView[] = ['mine', 'tier_a', 'unassigned', 'overdue', 'all']

export function QueueViews({
  filters,
  view,
  counts,
  ownerLabel,
}: {
  filters: LeadsFilters
  view: LeadQueueView
  counts: Partial<Record<LeadQueueView, number>> | undefined
  /** Name of the owner when `?owner=<userId>` is set. */
  ownerLabel?: string | null
}) {
  return (
    <div className="space-y-3">
      <nav aria-label="Vistas de leads" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex min-w-max gap-1 border-b border-border">
          {VIEW_ORDER.filter((v) => (LEAD_QUEUE_VIEWS as readonly string[]).includes(v)).map(
            (v) => {
              const active = v === view
              const count = counts?.[v]
              return (
                <li key={v}>
                  <Link
                    href={leadsHref({ view: v, tier: v === 'tier_a' ? undefined : filters.tier })}
                    scroll={false}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      '-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      active
                        ? 'border-foreground font-semibold text-foreground'
                        : 'border-transparent text-meta hover:text-foreground',
                      v === 'overdue' && count ? 'text-danger-ink hover:text-danger-ink' : '',
                    )}
                  >
                    {VIEW_LABEL[v]}
                    {count !== undefined && (
                      <span
                        className={cn(
                          'rounded-full px-1.5 text-xs tabular-nums',
                          v === 'overdue' && count > 0
                            ? 'bg-danger-soft text-danger-ink'
                            : 'bg-muted text-meta',
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </Link>
                </li>
              )
            },
          )}
        </ul>
      </nav>

      {view !== 'tier_a' && (
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">{COPY.tier}</legend>
          <TierChip
            href={leadsHref({ ...filters, tier: undefined, page: undefined })}
            active={!filters.tier}
          >
            {COPY.anyTier}
          </TierChip>
          {LEAD_TIER_FILTERS.map((tier) => (
            <TierChip
              key={tier}
              href={leadsHref({ ...filters, tier, page: undefined })}
              active={filters.tier === tier}
            >
              {COPY.tier} {tier}
            </TierChip>
          ))}
          {filters.owner && filters.owner !== 'me' && filters.owner !== 'unassigned' && (
            <TierChip href={leadsHref({ ...filters, owner: undefined, page: undefined })} active>
              {COPY.owner}: {ownerLabel ?? filters.owner.slice(0, 8)}
              <X aria-label="Quitar filtro de responsable" className="ml-1 h-3 w-3" />
            </TierChip>
          )}
        </fieldset>
      )}
    </div>
  )
}

function TierChip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border text-meta hover:border-foreground/40 hover:text-foreground',
      )}
    >
      {children}
    </Link>
  )
}

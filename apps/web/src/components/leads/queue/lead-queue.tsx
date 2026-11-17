'use client'

import { Button } from '@/components/ui/button'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { Inbox } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAssignLead, useLeadAssignees } from '../assign-lead'
import { COPY, VIEW_EMPTY } from '../copy'
import { type LeadsFilters, activeView, leadsHref, queueInput } from '../lead-filters'
import { BulkBar } from './bulk-bar'
import { LeadQueueCards } from './lead-queue-cards'
import { LeadQueueTable } from './lead-queue-table'
import { QueueViews } from './queue-views'
import { useIsDesktop, useQueueKeyboard } from './use-queue-keyboard'

type QueuePage = inferRouterOutputs<AppRouter>['leads']['queue']
type QueueCounts = inferRouterOutputs<AppRouter>['leads']['queueCounts']

/** The `/leads` work queue: views, the urgency-ordered list, bulk actions and keyboard paths. */
export function LeadQueue({
  initialPage,
  initialCounts,
  filters,
  canAssign,
}: {
  initialPage: QueuePage
  initialCounts: QueueCounts
  filters: LeadsFilters
  canAssign: boolean
}) {
  const router = useRouter()
  const view = activeView(filters)
  const input = queueInput(filters)

  const leadsRouter = trpc.leads as NonNullable<typeof trpc.leads>
  const queue = (leadsRouter.queue as NonNullable<typeof leadsRouter.queue>).useQuery(input, {
    initialData: initialPage,
    refetchInterval: 60_000,
  })
  const countsQuery = (
    leadsRouter.queueCounts as NonNullable<typeof leadsRouter.queueCounts>
  ).useQuery(filters.tier ? { tier: filters.tier } : undefined, {
    initialData: initialCounts,
    refetchInterval: 60_000,
  })
  const page = (queue.data as QueuePage | undefined) ?? initialPage
  const rows = page.items
  const counts = countsQuery.data as QueueCounts | undefined

  const assignees = useLeadAssignees()
  const assign = useAssignLead()
  const utils = trpc.useUtils()
  const leadsUtils = utils.leads as NonNullable<typeof utils.leads>
  const refresh = useCallback(() => {
    void (leadsUtils.queue as NonNullable<typeof leadsUtils.queue>).invalidate()
    void (leadsUtils.queueCounts as NonNullable<typeof leadsUtils.queueCounts>).invalidate()
  }, [leadsUtils])

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignOpenFor, setAssignOpenFor] = useState<string | null>(null)
  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const toggleAll = useCallback(() => {
    setSelected((current) =>
      rows.every((row) => current.has(row.id)) ? new Set() : new Set(rows.map((row) => row.id)),
    )
  }, [rows])

  const isDesktop = useIsDesktop()
  const { focusedIndex, setFocusedIndex } = useQueueKeyboard({
    rowCount: rows.length,
    enabled: assignOpenFor === null,
    onOpen: (index) => {
      const row = rows[index]
      if (row) router.push(`/leads/${row.id}`)
    },
    onAssign: (index) => {
      const row = rows[index]
      if (row && canAssign) setAssignOpenFor(row.id)
    },
    onToggle: (index) => {
      const row = rows[index]
      if (row) toggle(row.id)
    },
  })

  const ownerLabel = useMemo(() => {
    if (!filters.owner) return null
    const match = assignees.find((user) => user.id === filters.owner)
    return match ? (match.name ?? match.email) : null
  }, [assignees, filters.owner])

  const rowProps = {
    rows,
    now,
    focusedIndex,
    onFocusRow: setFocusedIndex,
    selected,
    onToggle: toggle,
    onToggleAll: toggleAll,
    assignees,
    onAssign: (id: string, ownerId: string) => {
      assign.mutate({ id, ownerId }, { onSuccess: refresh })
      setAssignOpenFor(null)
    },
    canAssign,
  }

  return (
    <div className="space-y-4">
      <QueueViews filters={filters} view={view} counts={counts} ownerLabel={ownerLabel} />

      {selected.size > 0 && (
        <BulkBar
          selectedIds={[...selected]}
          assignees={assignees}
          canAssign={canAssign}
          onDone={() => {
            setSelected(new Set())
            refresh()
          }}
          onClear={() => setSelected(new Set())}
        />
      )}

      {queue.isError ? (
        <QueueError message={queue.error.message} onRetry={() => void queue.refetch()} />
      ) : rows.length === 0 ? (
        <QueueEmpty view={view} />
      ) : (
        <>
          <LeadQueueTable
            {...rowProps}
            assignOpenFor={isDesktop ? assignOpenFor : null}
            onAssignOpenChange={setAssignOpenFor}
          />
          <LeadQueueCards
            {...rowProps}
            assignOpenFor={isDesktop ? null : assignOpenFor}
            onAssignOpenChange={setAssignOpenFor}
          />
        </>
      )}

      <QueuePager page={page} filters={filters} />
    </div>
  )
}

function QueueError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-border p-6 text-sm">
      <p className="font-medium">{COPY.loadError}</p>
      <p className="mt-1 text-meta">{message}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        {COPY.retry}
      </Button>
    </div>
  )
}

function QueuePager({ page, filters }: { page: QueuePage; filters: LeadsFilters }) {
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize))
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-meta">
      <p className="hidden md:block">{COPY.keyboardHint}</p>
      {page.total > 0 && (
        <nav aria-label="Paginación" className="flex items-center gap-2">
          <span className="tabular-nums">{COPY.pageOf(page.page, pages, page.total)}</span>
          {page.page > 1 && (
            <Button asChild variant="outline" size="sm">
              <Link href={leadsHref({ ...filters, page: page.page - 1 })}>{COPY.previous}</Link>
            </Button>
          )}
          {page.page < pages && (
            <Button asChild variant="outline" size="sm">
              <Link href={leadsHref({ ...filters, page: page.page + 1 })}>{COPY.next}</Link>
            </Button>
          )}
        </nav>
      )}
    </footer>
  )
}

function QueueEmpty({ view }: { view: keyof typeof VIEW_EMPTY }) {
  const copy = VIEW_EMPTY[view]
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-border px-6 py-14 text-center">
      <Inbox aria-hidden className="h-8 w-8 text-meta" />
      <h2 className="mt-3 text-[0.9375rem] font-semibold">{copy.title}</h2>
      <p className="mt-1 max-w-md text-sm text-meta">{copy.body}</p>
      {view !== 'all' && (
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link href={leadsHref({})}>Ver todos los leads</Link>
        </Button>
      )}
    </div>
  )
}

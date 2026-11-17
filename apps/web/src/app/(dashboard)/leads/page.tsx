import { COPY } from '@/components/leads/copy'
import { CreateLeadDialog } from '@/components/leads/create-lead-dialog'
import { activeView, parseLeadsFilters, queueInput } from '@/components/leads/lead-filters'
import { LeadQueue } from '@/components/leads/queue/lead-queue'
import { getServerCaller } from '@/lib/trpc/server'

interface LeadsPageProps {
  /** `?view=`, `?owner=me|unassigned|<userId>`, `?tier=A|B|C`, `?page=`: a shareable view. */
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const filters = parseLeadsFilters(await searchParams)
  const view = activeView(filters)
  const caller = await getServerCaller()
  const [page, counts, permissions] = await Promise.all([
    caller.leads.queue({
      view,
      ...(filters.owner && view !== 'mine' && view !== 'unassigned'
        ? { owner: filters.owner }
        : {}),
      ...(filters.tier && view !== 'tier_a' ? { tier: filters.tier } : {}),
      ...(filters.page ? { page: filters.page } : {}),
    }),
    caller.leads.queueCounts(filters.tier ? { tier: filters.tier } : undefined),
    caller.leads.permissions(),
  ])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">{COPY.pageTitle}</h1>
          <p className="mt-1 text-sm text-meta">{COPY.pageLead}</p>
        </div>
        <CreateLeadDialog />
      </header>
      <LeadQueue
        key={`${view}:${filters.owner ?? ''}:${filters.tier ?? ''}:${filters.page ?? 1}`}
        initialPage={page}
        initialCounts={counts}
        filters={filters}
        canAssign={permissions.canAssign}
      />
    </div>
  )
}

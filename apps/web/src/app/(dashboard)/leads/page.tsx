import { parseLeadsFilters } from '@/components/leads/lead-filters'
import { LeadsDataTable } from '@/components/leads/leads-data-table'
import { getServerCaller } from '@/lib/trpc/server'

interface LeadsPageProps {
  /** `?owner=me|unassigned|<userId>` and `?tier=A|B|C`: a shareable view. */
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const filters = parseLeadsFilters(await searchParams)
  const caller = await getServerCaller()
  const leads = await caller.leads.list(Object.keys(filters).length > 0 ? filters : undefined)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Leads</h1>
        <p className="text-muted-foreground">Track and qualify leads</p>
      </div>
      <LeadsDataTable
        key={`${filters.owner ?? ''}:${filters.tier ?? ''}`}
        initialData={leads}
        filters={filters}
      />
    </div>
  )
}

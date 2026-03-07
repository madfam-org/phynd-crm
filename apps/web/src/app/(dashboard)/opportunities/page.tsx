import { OpportunitiesDataTable } from '@/components/opportunities/opportunities-data-table'
import { getServerCaller } from '@/lib/trpc/server'

export default async function OpportunitiesPage() {
  const caller = await getServerCaller()
  const opportunities = await caller.opportunities.list()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Opportunities</h1>
        <p className="text-muted-foreground">Manage your sales pipeline</p>
      </div>
      <OpportunitiesDataTable initialData={opportunities} />
    </div>
  )
}

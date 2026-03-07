import { LeadsDataTable } from '@/components/leads/leads-data-table'
import { getServerCaller } from '@/lib/trpc/server'

export default async function LeadsPage() {
  const caller = await getServerCaller()
  const leads = await caller.leads.list()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Leads</h1>
        <p className="text-muted-foreground">Track and qualify leads</p>
      </div>
      <LeadsDataTable initialData={leads} />
    </div>
  )
}

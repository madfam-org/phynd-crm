import { CampaignsDataTable } from '@/components/campaigns/campaigns-data-table'
import { getServerCaller } from '@/lib/trpc/server'

export default async function CampaignsPage() {
  const caller = await getServerCaller()
  const campaigns = await caller.campaigns.list()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Campaigns</h1>
        <p className="text-muted-foreground">Manage marketing campaigns and UTM tracking</p>
      </div>
      <CampaignsDataTable initialData={campaigns} />
    </div>
  )
}

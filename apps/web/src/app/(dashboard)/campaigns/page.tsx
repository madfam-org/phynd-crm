import { CampaignsDataTable } from '@/components/campaigns/campaigns-data-table'
import { getServerCaller } from '@/lib/trpc/server'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Bot } from 'lucide-react'

export default async function CampaignsPage() {
  const caller = await getServerCaller()
  const campaigns = await caller.campaigns.list()

  // Count reddit bot drafts for the badge
  const draftCount = campaigns.items.filter(
    (c) => c.channel === 'reddit_bot' && c.status === 'draft'
  ).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Campaigns</h1>
          <p className="text-muted-foreground">Manage marketing campaigns and UTM tracking</p>
        </div>
        {draftCount > 0 && (
          <Button variant="outline" size="sm" className="border-amber-700/50 text-amber-400 hover:bg-amber-950/20" asChild>
            <Link href="/campaigns/drafts">
              <Bot className="mr-1.5 h-3.5 w-3.5" />
              {draftCount} Reddit Draft{draftCount !== 1 ? 's' : ''} Pending Review
            </Link>
          </Button>
        )}
      </div>
      <CampaignsDataTable initialData={campaigns} />
    </div>
  )
}

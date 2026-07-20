import { CampaignsDataTable } from '@/components/campaigns/campaigns-data-table'
import { Button } from '@/components/ui/button'
import { getServerCaller } from '@/lib/trpc/server'
import { Bot, ShieldCheck } from 'lucide-react'
import Link from 'next/link'

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ tulana?: string }>
}) {
  const params = await searchParams
  const caller = await getServerCaller()
  const [campaigns, pendingAuthorizations] = await Promise.all([
    caller.campaigns.list(),
    caller.campaignAuthorizations.listPending().catch(() => []),
  ])

  // Count reddit bot drafts for the badge
  const draftCount = campaigns.items.filter(
    (c: (typeof campaigns.items)[number]) => c.channel === 'reddit_bot' && c.status === 'draft',
  ).length

  const tulanaReviewCount = campaigns.items.filter(
    (c: (typeof campaigns.items)[number]) => c.status === 'needs_review' && c.skuKey,
  ).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Campaigns</h1>
          <p className="text-muted-foreground">
            Manage marketing campaigns, Tulana SKU imports, and UTM tracking
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-emerald-700/50 text-emerald-600 hover:bg-emerald-950/10 dark:text-emerald-400 dark:hover:bg-emerald-950/20"
            asChild
          >
            <Link href="/campaigns/authorizations">
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              {pendingAuthorizations.length > 0
                ? `${pendingAuthorizations.length} awaiting authorization`
                : 'Authorizations'}
            </Link>
          </Button>
          {tulanaReviewCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="border-violet-700/50 text-violet-300 hover:bg-violet-950/20"
              asChild
            >
              <Link href="/campaigns?tulana=needs_review">
                {tulanaReviewCount} Tulana import{tulanaReviewCount !== 1 ? 's' : ''} need review
              </Link>
            </Button>
          )}
          {draftCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="border-amber-700/50 text-amber-400 hover:bg-amber-950/20"
              asChild
            >
              <Link href="/campaigns/drafts">
                <Bot className="mr-1.5 h-3.5 w-3.5" />
                {draftCount} Reddit Draft{draftCount !== 1 ? 's' : ''} Pending Review
              </Link>
            </Button>
          )}
        </div>
      </div>
      <CampaignsDataTable
        initialData={campaigns}
        initialStatusFilter={params.tulana === 'needs_review' ? 'needs_review' : 'all'}
      />
    </div>
  )
}

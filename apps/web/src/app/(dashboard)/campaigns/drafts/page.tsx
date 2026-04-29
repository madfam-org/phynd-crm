import { DraftCampaignList } from '@/components/campaigns/draft-campaign-list'
import { Button } from '@/components/ui/button'
import { getServerCaller } from '@/lib/trpc/server'
import { Bot } from 'lucide-react'
import Link from 'next/link'

export default async function CampaignDraftsPage() {
  const caller = await getServerCaller()
  const all = await caller.campaigns.list({ limit: 200 })

  // Filter for reddit bot drafts server-side
  const drafts = all.items.filter(
    (c: (typeof all.items)[number]) => c.channel === 'reddit_bot' && c.status === 'draft',
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-3xl font-bold">Reddit Bot Drafts</h1>
          </div>
          <p className="mt-1 text-muted-foreground">
            Review AI-generated legal responses before they are eligible for publishing via{' '}
            <span className="font-mono text-sm">u/madfam-bot</span>. Each draft cites verified Tezca
            oracle evidence.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/campaigns">← All Campaigns</Link>
        </Button>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-amber-800/30 bg-amber-950/10 px-4 py-2.5 text-sm text-amber-400">
        <span className="font-medium">{drafts.length}</span>
        <span>draft{drafts.length !== 1 ? 's' : ''} pending legal review</span>
      </div>

      <DraftCampaignList initialDrafts={drafts} />
    </div>
  )
}

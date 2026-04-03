'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle, XCircle, ExternalLink, Bot } from 'lucide-react'

// Server-side props are passed in from the parent page
interface DraftCampaign {
  id: string
  name: string
  description: string | null
  channel: string | null
  status: string
  createdAt: Date
}

interface DraftReviewCardProps {
  campaign: DraftCampaign
  onApprove: (id: string) => Promise<void>
  onDiscard: (id: string) => Promise<void>
}

function DraftReviewCard({ campaign, onApprove, onDiscard }: DraftReviewCardProps) {
  const [loading, setLoading] = useState<'approving' | 'discarding' | null>(null)

  // Parse the description: split on "---\nTezca Evidence:" divider
  const parts = campaign.description?.split('---\nTezca Evidence:') ?? []
  const draftResponse = parts[0]?.replace('DRAFT PENDING APPROVAL:\n\n', '').trim() ?? ''
  const tezcaEvidence = parts[1]?.trim() ?? ''

  const handleApprove = async () => {
    setLoading('approving')
    await onApprove(campaign.id)
    setLoading(null)
  }

  const handleDiscard = async () => {
    setLoading('discarding')
    await onDiscard(campaign.id)
    setLoading(null)
  }

  return (
    <Card className="border border-border bg-card shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base font-semibold">{campaign.name}</CardTitle>
          </div>
          <Badge variant="outline" className="shrink-0 border-amber-400 text-amber-500 text-xs">
            Pending Review
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Created {new Date(campaign.createdAt).toLocaleString('es-MX')}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Drafted Bot Reply */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Drafted Reply (u/madfam-bot)
          </p>
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
            {draftResponse || <span className="text-muted-foreground italic">No draft generated.</span>}
          </div>
        </div>

        {/* Tezca Evidence */}
        {tezcaEvidence && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Tezca Legal Evidence
            </p>
            <div className="rounded-md border border-blue-800/30 bg-blue-950/10 p-3 text-xs text-blue-300 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
              {tezcaEvidence}
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-2 pt-3 border-t border-border">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          asChild
        >
          <Link href={campaign.name.includes('r/') ? `https://reddit.com/r/${campaign.name.split('r/')[1]?.split(' ')[0]}` : '#'} target="_blank">
            <ExternalLink className="mr-1.5 h-3 w-3" />
            View Subreddit
          </Link>
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-red-800/50 text-red-400 hover:bg-red-950/30 text-xs"
            onClick={handleDiscard}
            disabled={loading !== null}
          >
            <XCircle className="mr-1.5 h-3.5 w-3.5" />
            {loading === 'discarding' ? 'Discarding…' : 'Discard'}
          </Button>
          <Button
            size="sm"
            className="bg-green-700 hover:bg-green-600 text-white text-xs"
            onClick={handleApprove}
            disabled={loading !== null}
          >
            <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
            {loading === 'approving' ? 'Approving…' : 'Approve'}
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}

export function DraftCampaignList({ initialDrafts }: { initialDrafts: DraftCampaign[] }) {
  const [drafts, setDrafts] = useState(initialDrafts)

  const [posted, setPosted] = useState<string | null>(null)

  const removeDraft = (id: string) => setDrafts((prev) => prev.filter((d) => d.id !== id))

  const handleApprove = async (id: string) => {
    const res = await fetch('/api/campaigns/drafts/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'approved' }),
    })
    const data = await res.json() as { status: string; commentUrl?: string }

    if (data.status === 'posted' && data.commentUrl) {
      setPosted(data.commentUrl)
    }
    removeDraft(id)
  }

  const handleDiscard = async (id: string) => {
    await fetch('/api/campaigns/drafts/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'rejected' }),
    })
    removeDraft(id)
  }

  if (drafts.length === 0 && !posted) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <Bot className="mx-auto mb-3 h-10 w-10 opacity-30" />
        <p className="text-sm">No pending Reddit bot drafts. The pipeline is idle.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {posted && (
        <div className="flex items-center gap-3 rounded-md border border-green-700/40 bg-green-950/20 px-4 py-3 text-sm text-green-400">
          <CheckCircle className="h-4 w-4 shrink-0" />
          <span>Reply posted successfully as <span className="font-mono">u/madfam-bot</span>.</span>
          <a
            href={posted}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-xs underline underline-offset-2 hover:text-green-300"
          >
            <ExternalLink className="h-3 w-3" />
            View on Reddit
          </a>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {drafts.map((campaign) => (
          <DraftReviewCard
            key={campaign.id}
            campaign={campaign}
            onApprove={handleApprove}
            onDiscard={handleDiscard}
          />
        ))}
      </div>
    </div>
  )
}

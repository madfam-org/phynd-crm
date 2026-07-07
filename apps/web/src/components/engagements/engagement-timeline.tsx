'use client'

import { Badge } from '@/components/ui/badge'
import {
  type TimelineVisualTone,
  timelineEventLabel,
  timelineEventTone,
} from '@/lib/engagements/timeline-presentations'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { Activity, ArrowRight, Zap } from 'lucide-react'

interface EngagementTimelineProps {
  engagementId: string
}

type TimelineOutput = inferRouterOutputs<AppRouter>['engagements']['getTimeline']
type TimelineEntry = TimelineOutput[number]

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleString()
}

function eventToneClass(tone: TimelineVisualTone) {
  if (tone === 'milestone') {
    return 'border-violet-300/60 bg-violet-50/40 dark:border-violet-700/40 dark:bg-violet-950/20'
  }
  if (tone === 'blocked') {
    return 'border-amber-300/60 bg-amber-50/40 dark:border-amber-700/40 dark:bg-amber-950/20'
  }
  if (tone === 'failed') {
    return 'border-red-300/60 bg-red-50/40 dark:border-red-800/40 dark:bg-red-950/20'
  }
  return 'bg-card'
}

function eventStatusVariant(tone: TimelineVisualTone) {
  if (tone === 'milestone') return 'default' as const
  if (tone === 'blocked') return 'warning' as const
  return 'outline' as const
}

function TimelineEventItem({ entry }: { entry: Extract<TimelineEntry, { kind: 'event' }> }) {
  const tone = timelineEventTone(entry.status, entry.eventType)
  return (
    <li className="relative pl-10">
      <div className="absolute left-2 flex h-5 w-5 items-center justify-center rounded-full border bg-background">
        <Zap className="h-3 w-3" aria-hidden="true" />
      </div>
      <div className={`rounded-md border p-3 ${eventToneClass(tone)}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="uppercase text-[10px]">
              {entry.source}
            </Badge>
            <span className="text-sm font-medium">{timelineEventLabel(entry.eventType)}</span>
          </div>
          {entry.status && (
            <Badge variant={eventStatusVariant(tone)} className="text-[10px]">
              {entry.status}
            </Badge>
          )}
        </div>
        {entry.message && <p className="mt-1 text-sm text-muted-foreground">{entry.message}</p>}
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(entry.createdAt)}</p>
      </div>
    </li>
  )
}

function TimelineActivityItem({ entry }: { entry: Extract<TimelineEntry, { kind: 'activity' }> }) {
  return (
    <li className="relative pl-10">
      <div className="absolute left-2 flex h-5 w-5 items-center justify-center rounded-full border bg-background">
        <Activity className="h-3 w-3" aria-hidden="true" />
      </div>
      <div className="rounded-md border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              activity
            </Badge>
            <span className="text-sm font-medium">{entry.title}</span>
          </div>
          {entry.completedAt && (
            <Badge variant="success" className="text-[10px]">
              completed
            </Badge>
          )}
        </div>
        {entry.description && (
          <p className="mt-1 text-sm text-muted-foreground">{entry.description}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(entry.createdAt)}</p>
      </div>
    </li>
  )
}

function TimelineStageItem({
  entry,
}: { entry: Extract<TimelineEntry, { kind: 'stage_transition' }> }) {
  return (
    <li className="relative pl-10">
      <div className="absolute left-2 flex h-5 w-5 items-center justify-center rounded-full border bg-background">
        <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </div>
      <div className="rounded-md border bg-card p-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">
            stage move
          </Badge>
          <span className="text-sm">
            {entry.fromStageId ? `${entry.fromStageId} → ${entry.toStageId}` : entry.toStageId}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(entry.createdAt)}</p>
      </div>
    </li>
  )
}

function TimelineEntryItem({ entry }: { entry: TimelineEntry }) {
  if (entry.kind === 'event') return <TimelineEventItem entry={entry} />
  if (entry.kind === 'activity') return <TimelineActivityItem entry={entry} />
  return <TimelineStageItem entry={entry} />
}

export function EngagementTimeline({ engagementId }: EngagementTimelineProps) {
  const engagementsRouter = trpc.engagements as NonNullable<typeof trpc.engagements>
  const getTimeline = engagementsRouter.getTimeline as NonNullable<
    typeof engagementsRouter.getTimeline
  >
  const { data, isLoading } = getTimeline.useQuery({
    engagementId,
  })
  const timeline = (data as TimelineOutput | undefined) ?? []

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading timeline...</p>
  }

  if (timeline.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No timeline events yet. Ecosystem webhooks (Cotiza, Pravara, Selva, Karafiel) will populate
        this stream.
      </p>
    )
  }

  return (
    <div className="relative space-y-0">
      <div className="absolute left-4 top-0 bottom-0 w-px bg-border" aria-hidden="true" />
      <ul className="space-y-4" aria-label="Engagement timeline">
        {timeline.map((entry: TimelineEntry) => (
          <TimelineEntryItem entry={entry} key={`${entry.kind}-${entry.id}`} />
        ))}
      </ul>
    </div>
  )
}

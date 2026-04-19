'use client'

import { Badge } from '@/components/ui/badge'
import { trpc } from '@/lib/trpc/client'
import { Activity, ArrowRight, Zap } from 'lucide-react'

interface EngagementTimelineProps {
  engagementId: string
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleString()
}

export function EngagementTimeline({ engagementId }: EngagementTimelineProps) {
  const { data: timeline, isLoading } = trpc.engagements.getTimeline.useQuery({
    engagementId,
  })

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading timeline...</p>
  }

  if (!timeline || timeline.length === 0) {
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
        {timeline.map((entry) => {
          if (entry.kind === 'event') {
            return (
              <li key={`event-${entry.id}`} className="relative pl-10">
                <div className="absolute left-2 flex h-5 w-5 items-center justify-center rounded-full border bg-background">
                  <Zap className="h-3 w-3" aria-hidden="true" />
                </div>
                <div className="rounded-md border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="uppercase text-[10px]">
                        {entry.source}
                      </Badge>
                      <span className="text-sm font-medium">{entry.eventType}</span>
                    </div>
                    {entry.status && (
                      <Badge variant="outline" className="text-[10px]">
                        {entry.status}
                      </Badge>
                    )}
                  </div>
                  {entry.message && (
                    <p className="mt-1 text-sm text-muted-foreground">{entry.message}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDate(entry.createdAt)}
                  </p>
                </div>
              </li>
            )
          }
          if (entry.kind === 'activity') {
            return (
              <li key={`activity-${entry.id}`} className="relative pl-10">
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
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDate(entry.createdAt)}
                  </p>
                </div>
              </li>
            )
          }
          return (
            <li key={`stage-${entry.id}`} className="relative pl-10">
              <div className="absolute left-2 flex h-5 w-5 items-center justify-center rounded-full border bg-background">
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </div>
              <div className="rounded-md border bg-card p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    stage move
                  </Badge>
                  <span className="text-sm">
                    {entry.fromStageId
                      ? `${entry.fromStageId} → ${entry.toStageId}`
                      : entry.toStageId}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(entry.createdAt)}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

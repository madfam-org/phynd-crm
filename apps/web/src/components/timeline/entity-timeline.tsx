'use client'

import { Badge } from '@/components/ui/badge'
import { trpc } from '@/lib/trpc/client'
import type { EntityType } from '@phynd/types/crm'
import { Activity, ArrowRight, FileText } from 'lucide-react'

interface EntityTimelineProps {
  entityType: EntityType
  entityId: string
}

const typeConfig = {
  activity: { icon: Activity, label: 'Activity', variant: 'outline' as const },
  stage_move: { icon: ArrowRight, label: 'Stage Move', variant: 'secondary' as const },
  note: { icon: FileText, label: 'Note', variant: 'default' as const },
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleString()
}

export function EntityTimeline({ entityType, entityId }: EntityTimelineProps) {
  const { data: timeline, isLoading } = trpc.timeline.getTimeline.useQuery({
    entityType,
    entityId,
  })

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading timeline...</p>
  }

  if (!timeline || timeline.length === 0) {
    return <p className="text-sm text-muted-foreground">No timeline events yet.</p>
  }

  return (
    <div className="relative space-y-0">
      <div className="absolute left-4 top-0 bottom-0 w-px bg-border" aria-hidden="true" />
      <ul className="space-y-4" aria-label="Timeline">
        {timeline.map((entry) => {
          const config = typeConfig[entry.type]
          const Icon = config.icon
          return (
            <li key={entry.id} className="relative pl-10">
              <div className="absolute left-2 flex h-5 w-5 items-center justify-center rounded-full border bg-background">
                <Icon className="h-3 w-3" aria-hidden="true" />
              </div>
              <div className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={config.variant}>{config.label}</Badge>
                    <span className="text-sm font-medium">{entry.title}</span>
                  </div>
                  <time
                    className="shrink-0 text-xs text-muted-foreground"
                    dateTime={new Date(entry.timestamp).toISOString()}
                  >
                    {formatDate(entry.timestamp)}
                  </time>
                </div>
                {entry.description && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {entry.description}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

'use client'

import { Badge } from '@/components/ui/badge'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { AddArtifactDialog } from './add-artifact-dialog'

interface EngagementArtifactsPanelProps {
  engagementId: string
}

type ArtifactsOutput = inferRouterOutputs<AppRouter>['engagements']['listArtifacts']
type ArtifactRow = ArtifactsOutput[number]

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleString()
}

export function EngagementArtifactsPanel({ engagementId }: EngagementArtifactsPanelProps) {
  const engagementsRouter = trpc.engagements as NonNullable<typeof trpc.engagements>
  const listArtifacts = engagementsRouter.listArtifacts as NonNullable<
    typeof engagementsRouter.listArtifacts
  >
  const { data, isLoading } = listArtifacts.useQuery({
    engagementId,
  })
  const artifacts = (data as ArtifactsOutput | undefined) ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Proposals, invoices, deliverables, and receipts surfaced to the client portal.
        </p>
        <AddArtifactDialog engagementId={engagementId} />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading artifacts...</p>}

      {!isLoading && artifacts.length === 0 && (
        <p className="text-sm text-muted-foreground">No artifacts yet.</p>
      )}

      {!isLoading && artifacts.length > 0 && (
        <ul className="space-y-2" aria-label="Artifacts">
          {artifacts.map((a: ArtifactRow) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 rounded-md border bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {a.type.replace('_', ' ')}
                  </Badge>
                  {a.title ? (
                    <span className="truncate text-sm font-medium">{a.title}</span>
                  ) : (
                    <span className="truncate text-sm text-muted-foreground">Untitled</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Added {formatDate(a.createdAt)}
                </p>
              </div>
              {a.url && (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-sm font-medium text-primary hover:underline"
                >
                  Open
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

'use client'

import { Badge } from '@/components/ui/badge'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import Link from 'next/link'
import { CreateEngagementDialog } from './create-engagement-dialog'

interface ContactEngagementsPanelProps {
  contactId: string
}

const statusVariant: Record<
  string,
  'default' | 'success' | 'destructive' | 'secondary' | 'warning'
> = {
  active: 'default',
  completed: 'success',
  paused: 'warning',
  cancelled: 'destructive',
}

type EngagementsByContactOutput = inferRouterOutputs<AppRouter>['engagements']['listByContactId']
type ContactEngagementRow = EngagementsByContactOutput['items'][number]

export function ContactEngagementsPanel({ contactId }: ContactEngagementsPanelProps) {
  const engagementsRouter = trpc.engagements as NonNullable<typeof trpc.engagements>
  const listByContactId = engagementsRouter.listByContactId as NonNullable<
    typeof engagementsRouter.listByContactId
  >
  const { data, isLoading } = listByContactId.useQuery({ contactId })
  const engagements = (data as EngagementsByContactOutput | undefined)?.items ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Cross-platform client projects linked to this contact.
        </p>
        <CreateEngagementDialog
          contactId={contactId}
          trigger={
            <button
              type="button"
              className="rounded-md border bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent"
            >
              Create Engagement
            </button>
          }
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading engagements...</p>}

      {!isLoading && engagements.length === 0 && (
        <p className="text-sm text-muted-foreground">No engagements for this contact yet.</p>
      )}

      {!isLoading && engagements.length > 0 && (
        <ul className="space-y-2" aria-label="Contact engagements">
          {engagements.map((e: ContactEngagementRow) => (
            <li key={e.id}>
              <Link
                href={`/engagements/${e.id}`}
                className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.projectName}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Created {new Date(e.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Badge variant={statusVariant[e.status] ?? 'default'}>{e.status}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

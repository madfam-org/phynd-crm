import { NotesPanel } from '@/components/notes/notes-panel'
import { TagsPanel } from '@/components/tags/tags-panel'
import { EntityTimeline } from '@/components/timeline/entity-timeline'
import { Badge } from '@/components/ui/badge'
import { getServerCaller } from '@/lib/trpc/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'

interface OpportunityDetailPageProps {
  params: Promise<{ id: string }>
}

const statusVariant: Record<string, 'default' | 'success' | 'destructive'> = {
  open: 'default',
  won: 'success',
  lost: 'destructive',
}

export default async function OpportunityDetailPage({ params }: OpportunityDetailPageProps) {
  const { id } = await params
  const caller = await getServerCaller()

  const opp = await caller.opportunities.getById({ id })
  if (!opp) notFound()

  const [contact, stages] = await Promise.all([
    opp.contactId ? caller.contacts.getById({ id: opp.contactId }) : null,
    opp.pipelineId ? caller.pipelines.getStages({ pipelineId: opp.pipelineId }) : [],
  ])

  const stageName = stages.find((s) => s.id === opp.stageId)?.name ?? null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{opp.name}</h1>
        <p className="text-muted-foreground">Opportunity Detail</p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="text-sm text-muted-foreground">Value</span>
            <p className="text-xl font-bold">
              {opp.value ? `$${Number(opp.value).toLocaleString()}` : '—'}
            </p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Probability</span>
            <p className="font-medium">{opp.probability != null ? `${opp.probability}%` : '—'}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Status</span>
            <div className="mt-1">
              <Badge variant={statusVariant[opp.status] ?? 'default'}>{opp.status}</Badge>
            </div>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Stage</span>
            <p className="font-medium">{stageName ?? '—'}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Expected Close</span>
            <p className="font-medium">
              {opp.expectedCloseDate ? new Date(opp.expectedCloseDate).toLocaleDateString() : '—'}
            </p>
          </div>
          {contact && (
            <div>
              <span className="text-sm text-muted-foreground">Contact</span>
              <p className="font-medium">
                <Link href={`/clients/${contact.id}`} className="text-primary hover:underline">
                  {contact.name}
                </Link>
              </p>
            </div>
          )}
          <div>
            <span className="text-sm text-muted-foreground">Created</span>
            <p className="font-medium">{new Date(opp.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Timeline</h3>
            <EntityTimeline entityType="opportunity" entityId={id} />
          </div>
        </div>
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Notes</h3>
            <NotesPanel entityType="opportunity" entityId={id} />
          </div>
          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Tags</h3>
            <TagsPanel entityType="opportunity" entityId={id} />
          </div>
        </div>
      </div>
    </div>
  )
}

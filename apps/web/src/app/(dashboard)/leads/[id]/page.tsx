import { NotesPanel } from '@/components/notes/notes-panel'
import { TagsPanel } from '@/components/tags/tags-panel'
import { EntityTimeline } from '@/components/timeline/entity-timeline'
import { Badge } from '@/components/ui/badge'
import { getServerCaller } from '@/lib/trpc/server'
import { notFound } from 'next/navigation'

interface LeadDetailPageProps {
  params: Promise<{ id: string }>
}

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'secondary'> = {
  new: 'default',
  contacted: 'warning',
  qualified: 'success',
  unqualified: 'secondary',
  converted: 'success',
}

export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  const { id } = await params
  const caller = await getServerCaller()

  const lead = await caller.leads.getById({ id })
  if (!lead) notFound()

  const [contact, pipelines] = await Promise.all([
    lead.contactId ? caller.contacts.getById({ id: lead.contactId }) : null,
    caller.pipelines.list(),
  ])

  // Resolve stage name from pipeline stages
  let stageName: string | null = null
  if (lead.pipelineId) {
    const stages = await caller.pipelines.getStages({ pipelineId: lead.pipelineId })
    const stage = stages.find((s) => s.id === lead.stageId)
    stageName = stage?.name ?? null
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Lead Detail</h1>
        <p className="text-muted-foreground">
          {contact ? contact.name : `Lead ${lead.id.slice(0, 8)}`}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="text-sm text-muted-foreground">Source</span>
            <p className="font-medium">{lead.source ?? '—'}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Status</span>
            <div className="mt-1">
              <Badge variant={statusVariant[lead.status] ?? 'default'}>{lead.status}</Badge>
            </div>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Score</span>
            <p className="font-medium">{lead.score ?? '—'}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Stage</span>
            <p className="font-medium">{stageName ?? '—'}</p>
          </div>
          {contact && (
            <div>
              <span className="text-sm text-muted-foreground">Contact</span>
              <p className="font-medium">{contact.name}</p>
            </div>
          )}
          <div>
            <span className="text-sm text-muted-foreground">Created</span>
            <p className="font-medium">{new Date(lead.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Timeline</h3>
            <EntityTimeline entityType="lead" entityId={id} />
          </div>
        </div>
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Notes</h3>
            <NotesPanel entityType="lead" entityId={id} />
          </div>
          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Tags</h3>
            <TagsPanel entityType="lead" entityId={id} />
          </div>
        </div>
      </div>
    </div>
  )
}

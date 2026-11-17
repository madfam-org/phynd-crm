import { LeadDetailHeader } from '@/components/leads/detail/lead-detail-header'
import {
  CompanyPanel,
  ConsentPanel,
  ContactPanel,
  DuplicatesHint,
  EngagementPanel,
  MessagePanel,
  Panel,
  ScorePanel,
  TasksPanel,
} from '@/components/leads/detail/lead-detail-panels'
import { NotesPanel } from '@/components/notes/notes-panel'
import { TagsPanel } from '@/components/tags/tags-panel'
import { EntityTimeline } from '@/components/timeline/entity-timeline'
import { getServerCaller } from '@/lib/trpc/server'
import { notFound } from 'next/navigation'

interface LeadDetailPageProps {
  params: Promise<{ id: string }>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const caller = await getServerCaller()
  const [workspace, permissions] = await Promise.all([
    caller.leads.workspace({ id }),
    caller.leads.permissions(),
  ])
  if (!workspace) notFound()

  return (
    <div className="space-y-6">
      <LeadDetailHeader workspace={workspace} canAssign={permissions.canAssign} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <MessagePanel workspace={workspace} />
          <Panel title="Actividad">
            <EntityTimeline entityType="lead" entityId={id} />
          </Panel>
          <Panel title="Notas">
            <NotesPanel entityType="lead" entityId={id} />
          </Panel>
        </div>
        <aside className="space-y-6" aria-label="Detalles del lead">
          <ContactPanel workspace={workspace} />
          <TasksPanel workspace={workspace} />
          <ScorePanel workspace={workspace} />
          <ConsentPanel workspace={workspace} />
          <EngagementPanel workspace={workspace} />
          <CompanyPanel workspace={workspace} />
          <DuplicatesHint workspace={workspace} />
          <Panel title="Etiquetas">
            <TagsPanel entityType="lead" entityId={id} />
          </Panel>
        </aside>
      </div>
    </div>
  )
}

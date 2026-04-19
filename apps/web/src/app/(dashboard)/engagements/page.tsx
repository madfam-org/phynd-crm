import { EngagementsDataTable } from '@/components/engagements/engagements-data-table'
import { getServerCaller } from '@/lib/trpc/server'

export default async function EngagementsPage() {
  const caller = await getServerCaller()
  const engagements = await caller.engagements.list()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Engagements</h1>
        <p className="text-muted-foreground">
          Cross-platform client projects (Pravara fab + Selva digital + Cotiza proposals).
        </p>
      </div>
      <EngagementsDataTable initialData={engagements} />
    </div>
  )
}

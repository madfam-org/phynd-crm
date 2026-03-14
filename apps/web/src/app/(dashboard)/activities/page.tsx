import { ActivitiesDataTable } from '@/components/activities/activities-data-table'
import { getServerCaller } from '@/lib/trpc/server'

export default async function ActivitiesPage() {
  const caller = await getServerCaller()
  const activities = await caller.activities.list({})

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Activities</h1>
        <p className="text-muted-foreground">Track tasks, calls, and meetings</p>
      </div>
      <ActivitiesDataTable initialData={activities} />
    </div>
  )
}

import { VisitorsDataTable } from '@/components/visitors/visitors-data-table'
import { getServerCaller } from '@/lib/trpc/server'

export default async function VisitorsPage() {
  const caller = await getServerCaller()
  const [sessions, metrics] = await Promise.all([
    caller.visitorTracking.list(),
    caller.visitorTracking.metrics(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Visitors</h1>
        <p className="text-muted-foreground">Track anonymous and identified visitor sessions</p>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="Total Sessions" value={metrics.totalSessions} />
        <MetricCard label="Identified" value={metrics.identifiedSessions} />
        <MetricCard label="Anonymous" value={metrics.anonymousSessions} />
        <MetricCard label="Avg Duration" value={`${Math.round(metrics.avgDuration / 60)}m`} />
      </div>
      <VisitorsDataTable initialData={sessions} />
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  )
}

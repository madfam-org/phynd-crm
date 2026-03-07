import { FunnelView } from '@/components/funnel/funnel-view'
import { getServerCaller } from '@/lib/trpc/server'

export default async function FunnelPage() {
  const caller = await getServerCaller()
  const [metrics, visitorMetrics] = await Promise.all([
    caller.conversions.funnelMetrics(),
    caller.visitorTracking.metrics(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Funnel</h1>
        <p className="text-muted-foreground">Conversion funnel from visitors to closed deals</p>
      </div>
      <FunnelView funnelMetrics={metrics} visitorMetrics={visitorMetrics} />
    </div>
  )
}

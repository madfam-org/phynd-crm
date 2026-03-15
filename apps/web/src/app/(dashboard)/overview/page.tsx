import { AtRiskDealsCard } from '@/components/analytics/at-risk-deals-card'
import { ConversionFunnelChart } from '@/components/analytics/conversion-funnel-chart'
import { RevenueByStatusChart } from '@/components/analytics/revenue-by-status-chart'
import { Badge } from '@/components/ui/badge'
import { getServerCaller } from '@/lib/trpc/server'

export default async function DashboardPage() {
  const caller = await getServerCaller()
  const [contacts, leads, opportunities, conversions, revenueByStatus, activities, weighted, quotesData, ordersData] =
    await Promise.all([
      caller.contacts.list(),
      caller.leads.list(),
      caller.opportunities.list(),
      caller.analytics.conversionMetrics(),
      caller.analytics.revenueByStatus(),
      caller.activities.list({ limit: 5 }),
      caller.analytics.weightedPipelineValue(),
      caller.quotes.list(),
      caller.orders.list(),
    ])

  const openOpps = opportunities.items.filter((o) => o.status === 'open')
  const pipelineValue = openOpps.reduce((sum, o) => sum + Number(o.value ?? 0), 0)
  const openQuotes = quotesData.items.filter((q) => q.status === 'draft' || q.status === 'sent')
  const activeOrders = ordersData.items.filter((o) => o.status !== 'fulfilled' && o.status !== 'cancelled')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome to Phyne CRM</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <DashboardCard
          title="Contacts"
          value={String(contacts.items.length)}
          description="Total contacts"
        />
        <DashboardCard
          title="Leads"
          value={String(leads.items.length)}
          description="Active leads"
        />
        <DashboardCard
          title="Opportunities"
          value={String(openOpps.length)}
          description="Open deals"
        />
        <DashboardCard
          title="Pipeline Value"
          value={`$${pipelineValue.toLocaleString()}`}
          description={`Weighted: $${weighted.weightedValue.toLocaleString()}`}
        />
        <DashboardCard
          title="Open Quotes"
          value={String(openQuotes.length)}
          description={`${quotesData.items.length} total quotes`}
        />
        <DashboardCard
          title="Active Orders"
          value={String(activeOrders.length)}
          description={`${ordersData.items.length} total orders`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold">Conversion Funnel</h3>
          <ConversionFunnelChart data={conversions} />
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold">Revenue by Status</h3>
          <RevenueByStatusChart data={revenueByStatus} />
        </div>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h3 className="mb-4 text-lg font-semibold">At-Risk Deals</h3>
        <AtRiskDealsCard />
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h3 className="mb-4 text-lg font-semibold">Recent Activities</h3>
        {activities.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent activities.</p>
        ) : (
          <div className="space-y-3">
            {activities.items.map((activity) => (
              <div
                key={activity.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <Badge variant="outline">{activity.type}</Badge>
                  <span className="text-sm font-medium">{activity.title}</span>
                </div>
                <Badge variant={activity.status === 'completed' ? 'success' : 'secondary'}>
                  {activity.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DashboardCard({
  title,
  value,
  description,
}: {
  title: string
  value: string
  description: string
}) {
  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="text-sm font-medium text-muted-foreground">{title}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

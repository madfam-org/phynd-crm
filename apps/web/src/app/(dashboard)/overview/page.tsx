import { AtRiskDealsCard } from '@/components/analytics/at-risk-deals-card'
import { ConversionFunnelChart } from '@/components/analytics/conversion-funnel-chart'
import { RevenueByStatusChart } from '@/components/analytics/revenue-by-status-chart'
import { Badge } from '@/components/ui/badge'
import { isDemoSession } from '@/lib/demo'
import { getServerCaller } from '@/lib/trpc/server'
import { cookies } from 'next/headers'

export default async function DashboardPage() {
  const caller = await getServerCaller()
  const demoSessionId = isDemoSession(await cookies())
  const [
    contacts,
    leads,
    opportunities,
    conversions,
    revenueByStatus,
    activities,
    weighted,
    quotesData,
    ordersData,
    demoDataDegraded,
  ] = await loadDashboardData(caller, !!demoSessionId)

  type OpportunityRow = Awaited<ReturnType<typeof caller.opportunities.list>>['items'][number]
  type QuoteRow = Awaited<ReturnType<typeof caller.quotes.list>>['items'][number]
  type OrderRow = Awaited<ReturnType<typeof caller.orders.list>>['items'][number]
  type ActivityRow = Awaited<ReturnType<typeof caller.activities.list>>['items'][number]

  const openOpps = opportunities.items.filter((o: OpportunityRow) => o.status === 'open')
  const pipelineValue = openOpps.reduce(
    (sum: number, o: OpportunityRow) => sum + Number(o.value ?? 0),
    0,
  )
  const openQuotes = quotesData.items.filter(
    (q: QuoteRow) => q.status === 'draft' || q.status === 'sent',
  )
  const activeOrders = ordersData.items.filter(
    (o: OrderRow) => o.status !== 'fulfilled' && o.status !== 'cancelled',
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome to Phynd CRM</p>
      </div>
      {demoDataDegraded ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Demo data is still warming up. The workspace is available, and cards will populate as
          seeded records become reachable.
        </div>
      ) : null}
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
            {activities.items.map((activity: ActivityRow) => (
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

async function loadDashboardData(
  caller: Awaited<ReturnType<typeof getServerCaller>>,
  isDemo: boolean,
) {
  try {
    const result = await Promise.all([
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
    return [...result, false] as const
  } catch (error) {
    if (!isDemo) throw error
    console.error('Demo dashboard data failed to load', error)
    const emptyRevenueByStatus: Awaited<ReturnType<typeof caller.analytics.revenueByStatus>> = []
    return [
      { items: [] },
      { items: [] },
      { items: [] },
      { visitorToLead: 0, leadToOpportunity: 0, opportunityToWon: 0 },
      emptyRevenueByStatus,
      { items: [] },
      { weightedValue: 0 },
      { items: [] },
      { items: [] },
      true,
    ] as const
  }
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

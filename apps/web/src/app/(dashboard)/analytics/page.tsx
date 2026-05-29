import { AnalyticsDashboard } from '@/components/analytics/analytics-dashboard'
import { AnalyticsTrends } from '@/components/analytics/analytics-trends'
import { PaymentAttributionAnalytics } from '@/components/analytics/payment-attribution-analytics'
import { QuoteOrderAnalytics } from '@/components/analytics/quote-order-analytics'
import { SkuCampaignAnalytics } from '@/components/analytics/sku-campaign-analytics'
import { getServerCaller } from '@/lib/trpc/server'

export default async function AnalyticsPage() {
  const caller = await getServerCaller()
  const [summary, winRate, conversionMetrics, visitorAnalytics, revenueByStatus, defaultPipeline] =
    await Promise.all([
      caller.analytics.dashboardSummary(),
      caller.analytics.winRate(),
      caller.analytics.conversionMetrics(),
      caller.analytics.visitorAnalytics(),
      caller.analytics.revenueByStatus(),
      caller.pipelines.getDefault(),
    ])

  const stageVelocity = defaultPipeline
    ? await caller.analytics.stageVelocity({ pipelineId: defaultPipeline.id })
    : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Analytics</h1>
        <p className="text-muted-foreground">Pipeline, conversion, and visitor analytics</p>
      </div>
      <AnalyticsDashboard
        summary={summary}
        winRate={winRate}
        conversionMetrics={conversionMetrics}
        visitorAnalytics={visitorAnalytics}
        revenueByStatus={revenueByStatus}
        stageVelocity={stageVelocity}
      />
      <SkuCampaignAnalytics />
      <PaymentAttributionAnalytics />
      <QuoteOrderAnalytics />
      <div>
        <h2 className="text-xl font-semibold mb-4">Trends</h2>
        <AnalyticsTrends />
      </div>
    </div>
  )
}

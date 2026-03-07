'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface StageVelocityRow {
  stageId: string
  stageName: string
  avgDays: number
  transitionCount: number
}

interface AnalyticsDashboardProps {
  summary: {
    totalLeads: number
    openOpportunities: number
    pipelineValue: number
    recentVisitors: number
    winRate: number
  }
  winRate: {
    winRate: number
    total: number
    won: number
  }
  conversionMetrics: {
    visitorToLead: number
    leadToOpportunity: number
    opportunityToWon: number
  }
  visitorAnalytics: {
    total: number
    identified: number
    anonymous: number
    avgPageViews: number
  }
  revenueByStatus: Array<{
    status: string | null
    totalValue: number
    count: number
  }>
  stageVelocity?: StageVelocityRow[]
}

export function AnalyticsDashboard({
  summary,
  winRate,
  conversionMetrics,
  visitorAnalytics,
  revenueByStatus,
  stageVelocity,
}: AnalyticsDashboardProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <MetricCard label="Total Leads" value={summary.totalLeads} />
        <MetricCard label="Open Opps" value={summary.openOpportunities} />
        <MetricCard
          label="Pipeline Value"
          value={`$${Number(summary.pipelineValue).toLocaleString()}`}
        />
        <MetricCard label="Recent Visitors (7d)" value={summary.recentVisitors} />
        <MetricCard label="Win Rate" value={`${summary.winRate}%`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Win Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="text-4xl font-bold">{winRate.winRate}%</div>
              <div className="text-sm text-muted-foreground">
                {winRate.won} won out of {winRate.total} closed deals
              </div>
              <div className="h-3 rounded-full bg-muted">
                <div
                  className="h-3 rounded-full bg-green-500 transition-all"
                  style={{ width: `${winRate.winRate}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conversion Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <ConversionRow label="Visitor → Lead" value={conversionMetrics.visitorToLead} />
              <ConversionRow
                label="Lead → Opportunity"
                value={conversionMetrics.leadToOpportunity}
              />
              <ConversionRow label="Opportunity → Won" value={conversionMetrics.opportunityToWon} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Visitor Analytics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Total Visitors</span>
                <span className="font-medium">{visitorAnalytics.total}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Identified</span>
                <span className="font-medium">{visitorAnalytics.identified}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Anonymous</span>
                <span className="font-medium">{visitorAnalytics.anonymous}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Avg Page Views</span>
                <span className="font-medium">{visitorAnalytics.avgPageViews}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {stageVelocity && stageVelocity.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Avg Days in Stage</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stageVelocity.map((stage) => (
                  <div key={stage.stageId} className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{stage.stageName}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({stage.transitionCount} transitions)
                      </span>
                    </div>
                    <span className="text-lg font-semibold">
                      {Number(stage.avgDays).toFixed(1)}d
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Revenue by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {revenueByStatus.map((item) => (
                <div key={item.status ?? 'unknown'} className="flex justify-between">
                  <span className="text-sm capitalize text-muted-foreground">
                    {item.status ?? 'Unknown'} ({item.count})
                  </span>
                  <span className="font-medium">${Number(item.totalValue).toLocaleString()}</span>
                </div>
              ))}
              {revenueByStatus.length === 0 && (
                <p className="text-sm text-muted-foreground">No revenue data yet.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
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

function ConversionRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
    </div>
  )
}

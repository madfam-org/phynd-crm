'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface FunnelViewProps {
  funnelMetrics: {
    visitorToLead: number
    leadToOpportunity: number
    opportunityToWon: number
    offerRedemptions: number
    totalValue: number
  }
  visitorMetrics: {
    totalSessions: number
    identifiedSessions: number
    anonymousSessions: number
    avgDuration: number
  }
}

export function FunnelView({ funnelMetrics, visitorMetrics }: FunnelViewProps) {
  const stages = [
    {
      label: 'Visitors',
      value: visitorMetrics.totalSessions,
      color: 'bg-blue-500',
      width: 'w-full',
    },
    {
      label: 'Leads',
      value: funnelMetrics.visitorToLead,
      color: 'bg-yellow-500',
      width: 'w-4/5',
    },
    {
      label: 'Opportunities',
      value: funnelMetrics.leadToOpportunity,
      color: 'bg-orange-500',
      width: 'w-3/5',
    },
    {
      label: 'Won',
      value: funnelMetrics.opportunityToWon,
      color: 'bg-green-500',
      width: 'w-2/5',
    },
  ]

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Conversion Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {stages.map((stage) => (
              <div key={stage.label} className="flex items-center gap-4">
                <div className="w-28 text-sm font-medium">{stage.label}</div>
                <div className="flex-1">
                  <div
                    className={`${stage.color} ${stage.width} rounded-full py-2 text-center text-sm font-medium text-white transition-all`}
                  >
                    {stage.value}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conversion Rates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <ConversionRate
              from="Visitors"
              to="Leads"
              count={funnelMetrics.visitorToLead}
              total={visitorMetrics.totalSessions}
            />
            <ConversionRate
              from="Leads"
              to="Opportunities"
              count={funnelMetrics.leadToOpportunity}
              total={funnelMetrics.visitorToLead}
            />
            <ConversionRate
              from="Opportunities"
              to="Won"
              count={funnelMetrics.opportunityToWon}
              total={funnelMetrics.leadToOpportunity}
            />
            <div className="border-t pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Offer Redemptions</span>
                <span className="text-lg font-semibold">{funnelMetrics.offerRedemptions}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ConversionRate({
  from,
  to,
  count,
  total,
}: {
  from: string
  to: string
  count: number
  total: number
}) {
  const rate = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0'
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">
        {from} → {to}
      </span>
      <div className="text-right">
        <span className="text-lg font-semibold">{rate}%</span>
        <span className="ml-2 text-sm text-muted-foreground">({count})</span>
      </div>
    </div>
  )
}

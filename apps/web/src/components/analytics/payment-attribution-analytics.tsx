'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { trpc } from '@/lib/trpc/client'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface PaymentAttributionChartProps {
  byProvider: { provider: string; count: number; totalValue: number }[]
  byCampaign: { campaignKey: string; count: number; totalValue: number }[]
}

export function PaymentAttributionChart({ byProvider, byCampaign }: PaymentAttributionChartProps) {
  const providerData = byProvider.map((row) => ({
    label: row.provider,
    count: row.count,
    value: row.totalValue,
  }))

  const campaignData = byCampaign.map((row) => ({
    label: row.campaignKey,
    count: row.count,
    value: row.totalValue,
  }))

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={providerData}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="label" hide />
          <YAxis className="text-xs" tick={{ fill: 'currentColor' }} />
          <Tooltip
            labelFormatter={(_label, payload) => payload?.[0]?.payload?.label ?? ''}
            contentStyle={{
              backgroundColor: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '0.5rem',
              color: 'hsl(var(--popover-foreground))',
            }}
          />
          <Legend />
          <Bar dataKey="count" fill="hsl(221 83% 53%)" name="Payments" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={campaignData}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="label" hide />
          <YAxis className="text-xs" tick={{ fill: 'currentColor' }} />
          <Tooltip
            labelFormatter={(_label, payload) => payload?.[0]?.payload?.label ?? ''}
            contentStyle={{
              backgroundColor: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '0.5rem',
              color: 'hsl(var(--popover-foreground))',
            }}
          />
          <Legend />
          <Bar
            dataKey="value"
            fill="hsl(142 76% 36%)"
            name="Revenue (major)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function PaymentAttributionAnalytics() {
  const analyticsRouter = trpc.analytics as NonNullable<typeof trpc.analytics>
  const paymentAttributionSummary = analyticsRouter.paymentAttributionSummary as NonNullable<
    typeof analyticsRouter.paymentAttributionSummary
  >

  const { data } = paymentAttributionSummary.useQuery(undefined)

  if (!data || data.totalPayments === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>RouteCraft payment attribution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Metric label="Payments" value={String(data.totalPayments)} />
          <Metric label="Linked to contact" value={`${data.linkRate}%`} />
          <Metric label="Unlinked" value={String(data.unlinkedPayments)} />
          <Metric label="Revenue" value={`$${data.totalRevenue.toLocaleString()}`} />
        </div>
        <PaymentAttributionChart byProvider={data.byProvider} byCampaign={data.byCampaign} />
      </CardContent>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  )
}

'use client'

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

interface SkuFunnelEntry {
  skuKey: string
  status?: string
  eventType?: string
  count: number
}

interface SkuCampaignFunnelChartProps {
  campaignFunnel: SkuFunnelEntry[]
  signalFunnel: SkuFunnelEntry[]
}

export function SkuCampaignFunnelChart({
  campaignFunnel,
  signalFunnel,
}: SkuCampaignFunnelChartProps) {
  const campaignData = campaignFunnel.map((row) => ({
    count: row.count,
    label: `${row.skuKey} · ${row.status?.replace('_', ' ') ?? 'unknown'}`,
    skuKey: row.skuKey,
  }))

  const signalData = signalFunnel.map((row) => ({
    count: row.count,
    label: `${row.skuKey} · ${row.eventType ?? 'unknown'}`,
    skuKey: row.skuKey,
  }))

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={campaignData}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="label" className="text-xs" tick={{ fill: 'currentColor' }} hide />
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
            dataKey="count"
            fill="hsl(262 83% 58%)"
            name="Tulana campaigns by status"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={signalData}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="label" className="text-xs" tick={{ fill: 'currentColor' }} hide />
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
            dataKey="count"
            fill="hsl(142 76% 36%)"
            name="Buyer signals by event"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

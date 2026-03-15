'use client'

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

interface FunnelEntry {
  status: string
  count: number
  totalValue: number
}

interface QuoteOrderFunnelChartProps {
  quoteFunnel: FunnelEntry[]
  orderFunnel: FunnelEntry[]
}

export function QuoteOrderFunnelChart({ quoteFunnel, orderFunnel }: QuoteOrderFunnelChartProps) {
  const quoteData = quoteFunnel.map((q) => ({
    count: q.count,
    status: q.status,
    value: Number(q.totalValue),
  }))

  const orderData = orderFunnel.map((o) => ({
    count: o.count,
    status: o.status.replace('_', ' '),
    value: Number(o.totalValue),
  }))

  const chartData = [
    ...quoteData.map((d) => ({ ...d, type: 'Quote' })),
    ...orderData.map((d) => ({ ...d, type: 'Order' })),
  ]

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="status" className="text-xs" tick={{ fill: 'currentColor' }} />
        <YAxis className="text-xs" tick={{ fill: 'currentColor' }} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '0.5rem',
            color: 'hsl(var(--popover-foreground))',
          }}
        />
        <Legend />
        <Bar dataKey="count" fill="hsl(var(--primary))" name="Count" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

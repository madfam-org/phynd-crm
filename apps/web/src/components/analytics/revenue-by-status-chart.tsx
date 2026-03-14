'use client'

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

interface RevenueData {
  status: string
  totalValue: number
  count: number
}

interface RevenueByStatusChartProps {
  data: RevenueData[]
}

const STATUS_COLORS: Record<string, string> = {
  open: '#3b82f6',
  won: '#22c55e',
  lost: '#ef4444',
}

export function RevenueByStatusChart({ data }: RevenueByStatusChartProps) {
  const chartData = data.map((d) => ({
    name: d.status.charAt(0).toUpperCase() + d.status.slice(1),
    value: Number(d.totalValue),
    count: d.count,
  }))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={100}
          label={({ name, value }) => `${name}: $${value.toLocaleString()}`}
        >
          {chartData.map((entry) => (
            <Cell key={entry.name} fill={STATUS_COLORS[entry.name.toLowerCase()] ?? '#8b5cf6'} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '0.5rem',
            color: 'hsl(var(--popover-foreground))',
          }}
          formatter={(value) => [`$${Number(value).toLocaleString()}`, 'Revenue']}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  )
}

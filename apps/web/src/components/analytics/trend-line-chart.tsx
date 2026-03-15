'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface LineConfig {
  key: string
  color: string
  label: string
}

interface TrendLineChartProps {
  data: Record<string, unknown>[]
  lines: LineConfig[]
  xAxisKey: string
}

export function TrendLineChart({ data, lines, xAxisKey }: TrendLineChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No data for the selected period
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey={xAxisKey}
          className="text-xs"
          tick={{ fill: 'currentColor' }}
          tickFormatter={(val: string) => {
            const d = new Date(val)
            return Number.isNaN(d.getTime())
              ? val
              : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
          }}
        />
        <YAxis className="text-xs" tick={{ fill: 'currentColor' }} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '0.5rem',
            color: 'hsl(var(--popover-foreground))',
          }}
          labelFormatter={(val) => {
            const str = String(val)
            const d = new Date(str)
            return Number.isNaN(d.getTime())
              ? str
              : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
          }}
        />
        {lines.map((line) => (
          <Area
            key={line.key}
            type="monotone"
            dataKey={line.key}
            name={line.label}
            stroke={line.color}
            fill={line.color}
            fillOpacity={0.1}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

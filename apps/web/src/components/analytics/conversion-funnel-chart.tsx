'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

interface ConversionFunnelChartProps {
  data: {
    visitorToLead: number
    leadToOpportunity: number
    opportunityToWon: number
  }
}

export function ConversionFunnelChart({ data }: ConversionFunnelChartProps) {
  const chartData = [
    { stage: 'Visitor \u2192 Lead', count: data.visitorToLead },
    { stage: 'Lead \u2192 Opportunity', count: data.leadToOpportunity },
    { stage: 'Opportunity \u2192 Won', count: data.opportunityToWon },
  ]

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="stage" className="text-xs" tick={{ fill: 'currentColor' }} />
        <YAxis className="text-xs" tick={{ fill: 'currentColor' }} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '0.5rem',
            color: 'hsl(var(--popover-foreground))',
          }}
        />
        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

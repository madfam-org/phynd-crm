'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

interface StageVelocityData {
  stageId: string
  stageName: string
  avgDays: number
  transitionCount: number
}

interface PipelineVelocityChartProps {
  data: StageVelocityData[]
}

export function PipelineVelocityChart({ data }: PipelineVelocityChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="stageName" className="text-xs" tick={{ fill: 'currentColor' }} />
        <YAxis
          label={{ value: 'Avg Days', angle: -90, position: 'insideLeft', fill: 'currentColor' }}
          className="text-xs"
          tick={{ fill: 'currentColor' }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '0.5rem',
            color: 'hsl(var(--popover-foreground))',
          }}
          formatter={(value) => [`${value} days`, 'Avg Time']}
        />
        <Bar dataKey="avgDays" fill="hsl(var(--accent-blue, #3b82f6))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

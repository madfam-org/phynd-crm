'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { trpc } from '@/lib/trpc/client'
import { useState } from 'react'
import { TrendLineChart } from './trend-line-chart'

type Bucket = 'day' | 'month' | 'week'

function defaultDateFrom() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

function defaultDateTo() {
  return new Date().toISOString().slice(0, 10)
}

export function AnalyticsTrends() {
  const [dateFrom, setDateFrom] = useState(defaultDateFrom)
  const [dateTo, setDateTo] = useState(defaultDateTo)
  const [bucket, setBucket] = useState<Bucket>('day')

  const queryInput = {
    bucket,
    dateFrom: new Date(dateFrom),
    dateTo: new Date(dateTo),
  }

  const analyticsRouter = trpc.analytics as NonNullable<typeof trpc.analytics>
  const leadTrendQuery = analyticsRouter.leadTrend as NonNullable<typeof analyticsRouter.leadTrend>
  const opportunityTrendQuery = analyticsRouter.opportunityTrend as NonNullable<
    typeof analyticsRouter.opportunityTrend
  >
  const conversionTrendQuery = analyticsRouter.conversionTrend as NonNullable<
    typeof analyticsRouter.conversionTrend
  >
  const visitorTrendQuery = analyticsRouter.visitorTrend as NonNullable<
    typeof analyticsRouter.visitorTrend
  >

  const { data: leadTrend = [] } = leadTrendQuery.useQuery(queryInput)
  const { data: oppTrend = [] } = opportunityTrendQuery.useQuery(queryInput)
  const { data: convTrend = [] } = conversionTrendQuery.useQuery(queryInput)
  const { data: visitorTrend = [] } = visitorTrendQuery.useQuery(queryInput)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-1">
          <Label htmlFor="trend-date-from" className="text-xs">
            From
          </Label>
          <Input
            id="trend-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="trend-date-to" className="text-xs">
            To
          </Label>
          <Input
            id="trend-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Bucket</Label>
          <Select value={bucket} onValueChange={(v) => setBucket(v as Bucket)}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendLineChart
              data={leadTrend}
              xAxisKey="period"
              lines={[{ color: 'hsl(var(--primary))', key: 'count', label: 'Leads' }]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Opportunity Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendLineChart
              data={oppTrend}
              xAxisKey="period"
              lines={[
                { color: 'hsl(var(--primary))', key: 'count', label: 'Count' },
                { color: 'hsl(142 76% 36%)', key: 'totalValue', label: 'Value' },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conversion Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendLineChart
              data={convTrend}
              xAxisKey="period"
              lines={[
                { color: 'hsl(221 83% 53%)', key: 'visitorToLead', label: 'Visitor to Lead' },
                { color: 'hsl(142 76% 36%)', key: 'leadToOpp', label: 'Lead to Opp' },
                { color: 'hsl(45 93% 47%)', key: 'oppToWon', label: 'Opp to Won' },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Visitor Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendLineChart
              data={visitorTrend}
              xAxisKey="period"
              lines={[
                { color: 'hsl(var(--primary))', key: 'total', label: 'Total' },
                { color: 'hsl(142 76% 36%)', key: 'identified', label: 'Identified' },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

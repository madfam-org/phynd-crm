'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { trpc } from '@/lib/trpc/client'
import { QuoteOrderFunnelChart } from './quote-order-funnel-chart'

export function QuoteOrderAnalytics() {
  const analyticsRouter = trpc.analytics as NonNullable<typeof trpc.analytics>
  const quoteFunnel = analyticsRouter.quoteFunnel as NonNullable<typeof analyticsRouter.quoteFunnel>
  const orderFunnel = analyticsRouter.orderFunnel as NonNullable<typeof analyticsRouter.orderFunnel>
  const quoteToOrderRate = analyticsRouter.quoteToOrderRate as NonNullable<
    typeof analyticsRouter.quoteToOrderRate
  >

  const { data: quotes = [] } = quoteFunnel.useQuery()
  const { data: orders = [] } = orderFunnel.useQuery()
  const { data: conversionRate } = quoteToOrderRate.useQuery()

  if (quotes.length === 0 && orders.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Quote & order funnel</CardTitle>
        {conversionRate != null && (
          <p className="text-sm text-muted-foreground">
            Quote → order rate:{' '}
            <span className="font-medium text-foreground">{conversionRate.rate}%</span>
          </p>
        )}
      </CardHeader>
      <CardContent>
        <QuoteOrderFunnelChart quoteFunnel={quotes} orderFunnel={orders} />
      </CardContent>
    </Card>
  )
}

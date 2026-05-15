'use client'

import { Badge } from '@/components/ui/badge'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import Link from 'next/link'

type AtRiskDealsOutput = inferRouterOutputs<AppRouter>['analytics']['atRiskDeals']
type AtRiskDeal = AtRiskDealsOutput[number]

export function AtRiskDealsCard() {
  const analyticsRouter = trpc.analytics as NonNullable<typeof trpc.analytics>
  const atRiskDealsQuery = analyticsRouter.atRiskDeals as NonNullable<
    typeof analyticsRouter.atRiskDeals
  >
  const { data, isLoading } = atRiskDealsQuery.useQuery()
  const atRiskDeals = (data ?? []) as AtRiskDealsOutput

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading at-risk deals...</p>
  }

  if (!atRiskDeals || atRiskDeals.length === 0) {
    return <p className="text-sm text-muted-foreground">No at-risk deals.</p>
  }

  return (
    <div className="space-y-3">
      {atRiskDeals.map((deal: AtRiskDeal) => (
        <div
          key={deal.opportunityId}
          className="flex items-center justify-between rounded-lg border p-3"
        >
          <div className="min-w-0 flex-1">
            <Link
              href={`/opportunities/${deal.opportunityId}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              {deal.name}
            </Link>
            <p className="text-xs text-muted-foreground">
              {deal.stageName} &middot; ${deal.value.toLocaleString()} &middot; {deal.daysInStage}d
              in stage (avg: {deal.averageDays}d)
            </p>
          </div>
          <Badge variant={deal.riskLevel === 'critical' ? 'destructive' : 'warning'}>
            {deal.riskLevel}
          </Badge>
        </div>
      ))}
    </div>
  )
}

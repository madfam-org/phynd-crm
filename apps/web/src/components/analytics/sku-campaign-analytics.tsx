'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { trpc } from '@/lib/trpc/client'
import { SkuCampaignFunnelChart } from './sku-campaign-funnel-chart'

export function SkuCampaignAnalytics() {
  const analyticsRouter = trpc.analytics as NonNullable<typeof trpc.analytics>
  const skuCampaignFunnel = analyticsRouter.skuCampaignFunnel as NonNullable<
    typeof analyticsRouter.skuCampaignFunnel
  >
  const skuBuyerSignalFunnel = analyticsRouter.skuBuyerSignalFunnel as NonNullable<
    typeof analyticsRouter.skuBuyerSignalFunnel
  >

  const { data: campaignFunnel = [] } = skuCampaignFunnel.useQuery()
  const { data: signalFunnel = [] } = skuBuyerSignalFunnel.useQuery()

  if (campaignFunnel.length === 0 && signalFunnel.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>SKU campaign funnel</CardTitle>
      </CardHeader>
      <CardContent>
        <SkuCampaignFunnelChart campaignFunnel={campaignFunnel} signalFunnel={signalFunnel} />
      </CardContent>
    </Card>
  )
}

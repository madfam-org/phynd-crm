import { isFeatureEnabled } from '@phynd/config/features'
import { AnalyticsService } from '@phynd/services'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'
import { entityId } from '../validation'

function assertAnalytics() {
  if (!isFeatureEnabled('analytics')) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Feature not enabled: analytics' })
  }
}

const dateRangeInput = z
  .object({
    dateFrom: z.date().optional(),
    dateTo: z.date().optional(),
  })
  .optional()

function toDateRange(input?: { dateFrom?: Date; dateTo?: Date }) {
  if (!input?.dateFrom && !input?.dateTo) return undefined
  return { from: input?.dateFrom, to: input?.dateTo }
}

export const analyticsRouter = router({
  pipelineVelocity: protectedProcedure
    .input(
      z.object({
        pipelineId: entityId,
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      assertAnalytics()
      const service = new AnalyticsService(ctx)
      return service.getPipelineVelocity(input.pipelineId, toDateRange(input))
    }),

  winRate: protectedProcedure.input(dateRangeInput).query(({ ctx, input }) => {
    assertAnalytics()
    const service = new AnalyticsService(ctx)
    return service.getWinRate(toDateRange(input ?? undefined))
  }),

  conversionMetrics: protectedProcedure.input(dateRangeInput).query(({ ctx, input }) => {
    assertAnalytics()
    const service = new AnalyticsService(ctx)
    return service.getConversionMetrics(toDateRange(input ?? undefined))
  }),

  visitorAnalytics: protectedProcedure.input(dateRangeInput).query(({ ctx, input }) => {
    assertAnalytics()
    const service = new AnalyticsService(ctx)
    return service.getVisitorAnalytics(toDateRange(input ?? undefined))
  }),

  revenueByStatus: protectedProcedure.query(({ ctx }) => {
    assertAnalytics()
    const service = new AnalyticsService(ctx)
    return service.getRevenueByStatus()
  }),

  stageVelocity: protectedProcedure
    .input(
      z.object({
        pipelineId: entityId,
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      assertAnalytics()
      const service = new AnalyticsService(ctx)
      return service.getStageVelocity(input.pipelineId, toDateRange(input))
    }),

  stageTransitions: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(['lead', 'opportunity']),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      assertAnalytics()
      const service = new AnalyticsService(ctx)
      return service.getStageTransitions(input.entityType, input.limit)
    }),

  healthTrend: protectedProcedure
    .input(
      z.object({
        provider: z.string(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      assertAnalytics()
      const service = new AnalyticsService(ctx)
      return service.getHealthTrend(input.provider, input.limit)
    }),

  campaignPerformance: protectedProcedure
    .input(z.object({ campaignId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      assertAnalytics()
      const service = new AnalyticsService(ctx)
      return service.getCampaignPerformance(input.campaignId)
    }),

  allCampaignPerformance: protectedProcedure.query(({ ctx }) => {
    assertAnalytics()
    const service = new AnalyticsService(ctx)
    return service.getAllCampaignPerformance()
  }),

  weightedPipelineValue: protectedProcedure.query(({ ctx }) => {
    assertAnalytics()
    const service = new AnalyticsService(ctx)
    return service.getWeightedPipelineValue()
  }),

  atRiskDeals: protectedProcedure
    .input(
      z
        .object({
          staleThresholdDays: z.number().int().min(1).max(365).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      assertAnalytics()
      const service = new AnalyticsService(ctx)
      return service.getAtRiskDeals(input?.staleThresholdDays)
    }),

  leadTrend: protectedProcedure
    .input(
      z.object({
        bucket: z.enum(['day', 'week', 'month']),
        dateFrom: z.date(),
        dateTo: z.date(),
      }),
    )
    .query(({ ctx, input }) => {
      assertAnalytics()
      const service = new AnalyticsService(ctx)
      return service.getLeadTrend({ from: input.dateFrom, to: input.dateTo }, input.bucket)
    }),

  opportunityTrend: protectedProcedure
    .input(
      z.object({
        bucket: z.enum(['day', 'week', 'month']),
        dateFrom: z.date(),
        dateTo: z.date(),
      }),
    )
    .query(({ ctx, input }) => {
      assertAnalytics()
      const service = new AnalyticsService(ctx)
      return service.getOpportunityTrend({ from: input.dateFrom, to: input.dateTo }, input.bucket)
    }),

  conversionTrend: protectedProcedure
    .input(
      z.object({
        bucket: z.enum(['day', 'week', 'month']),
        dateFrom: z.date(),
        dateTo: z.date(),
      }),
    )
    .query(({ ctx, input }) => {
      assertAnalytics()
      const service = new AnalyticsService(ctx)
      return service.getConversionTrend({ from: input.dateFrom, to: input.dateTo }, input.bucket)
    }),

  visitorTrend: protectedProcedure
    .input(
      z.object({
        bucket: z.enum(['day', 'week', 'month']),
        dateFrom: z.date(),
        dateTo: z.date(),
      }),
    )
    .query(({ ctx, input }) => {
      assertAnalytics()
      const service = new AnalyticsService(ctx)
      return service.getVisitorTrend({ from: input.dateFrom, to: input.dateTo }, input.bucket)
    }),

  dashboardSummary: protectedProcedure.input(dateRangeInput).query(({ ctx, input }) => {
    assertAnalytics()
    const service = new AnalyticsService(ctx)
    return service.getDashboardSummary(toDateRange(input ?? undefined))
  }),

  quoteFunnel: protectedProcedure.query(({ ctx }) => {
    assertAnalytics()
    const service = new AnalyticsService(ctx)
    return service.getQuoteFunnel()
  }),

  orderFunnel: protectedProcedure.query(({ ctx }) => {
    assertAnalytics()
    const service = new AnalyticsService(ctx)
    return service.getOrderFunnel()
  }),

  quoteToOrderRate: protectedProcedure.query(({ ctx }) => {
    assertAnalytics()
    const service = new AnalyticsService(ctx)
    return service.getQuoteToOrderRate()
  }),

  skuCampaignFunnel: protectedProcedure.query(({ ctx }) => {
    assertAnalytics()
    const service = new AnalyticsService(ctx)
    return service.getSkuCampaignFunnel()
  }),

  skuBuyerSignalFunnel: protectedProcedure.query(({ ctx }) => {
    assertAnalytics()
    const service = new AnalyticsService(ctx)
    return service.getSkuBuyerSignalFunnel()
  }),

  paymentAttributionSummary: protectedProcedure.input(dateRangeInput).query(({ ctx, input }) => {
    assertAnalytics()
    const service = new AnalyticsService(ctx)
    return service.getPaymentAttributionSummary(toDateRange(input ?? undefined))
  }),

  signalAttribution: protectedProcedure.input(dateRangeInput).query(({ ctx, input }) => {
    assertAnalytics()
    const service = new AnalyticsService(ctx)
    return service.getSignalAttribution(toDateRange(input ?? undefined))
  }),
})

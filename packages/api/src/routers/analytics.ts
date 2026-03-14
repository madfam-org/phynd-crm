import { AnalyticsService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

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
        pipelineId: z.string().uuid(),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const service = new AnalyticsService(ctx)
      return service.getPipelineVelocity(input.pipelineId, toDateRange(input))
    }),

  winRate: protectedProcedure.input(dateRangeInput).query(({ ctx, input }) => {
    const service = new AnalyticsService(ctx)
    return service.getWinRate(toDateRange(input ?? undefined))
  }),

  conversionMetrics: protectedProcedure.input(dateRangeInput).query(({ ctx, input }) => {
    const service = new AnalyticsService(ctx)
    return service.getConversionMetrics(toDateRange(input ?? undefined))
  }),

  visitorAnalytics: protectedProcedure.input(dateRangeInput).query(({ ctx, input }) => {
    const service = new AnalyticsService(ctx)
    return service.getVisitorAnalytics(toDateRange(input ?? undefined))
  }),

  revenueByStatus: protectedProcedure.query(({ ctx }) => {
    const service = new AnalyticsService(ctx)
    return service.getRevenueByStatus()
  }),

  stageVelocity: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string().uuid(),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
      }),
    )
    .query(({ ctx, input }) => {
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
      const service = new AnalyticsService(ctx)
      return service.getHealthTrend(input.provider, input.limit)
    }),

  campaignPerformance: protectedProcedure
    .input(z.object({ campaignId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      const service = new AnalyticsService(ctx)
      return service.getCampaignPerformance(input.campaignId)
    }),

  allCampaignPerformance: protectedProcedure.query(({ ctx }) => {
    const service = new AnalyticsService(ctx)
    return service.getAllCampaignPerformance()
  }),

  weightedPipelineValue: protectedProcedure.query(({ ctx }) => {
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
      const service = new AnalyticsService(ctx)
      return service.getAtRiskDeals(input?.staleThresholdDays)
    }),

  dashboardSummary: protectedProcedure.input(dateRangeInput).query(({ ctx, input }) => {
    const service = new AnalyticsService(ctx)
    return service.getDashboardSummary(toDateRange(input ?? undefined))
  }),
})

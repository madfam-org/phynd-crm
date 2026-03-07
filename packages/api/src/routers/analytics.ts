import { AnalyticsService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

export const analyticsRouter = router({
  pipelineVelocity: protectedProcedure
    .input(z.object({ pipelineId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      const service = new AnalyticsService(ctx)
      return service.getPipelineVelocity(input.pipelineId)
    }),

  winRate: protectedProcedure.query(({ ctx }) => {
    const service = new AnalyticsService(ctx)
    return service.getWinRate()
  }),

  conversionMetrics: protectedProcedure.query(({ ctx }) => {
    const service = new AnalyticsService(ctx)
    return service.getConversionMetrics()
  }),

  visitorAnalytics: protectedProcedure.query(({ ctx }) => {
    const service = new AnalyticsService(ctx)
    return service.getVisitorAnalytics()
  }),

  revenueByStatus: protectedProcedure.query(({ ctx }) => {
    const service = new AnalyticsService(ctx)
    return service.getRevenueByStatus()
  }),

  stageVelocity: protectedProcedure
    .input(z.object({ pipelineId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      const service = new AnalyticsService(ctx)
      return service.getStageVelocity(input.pipelineId)
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

  dashboardSummary: protectedProcedure.query(({ ctx }) => {
    const service = new AnalyticsService(ctx)
    return service.getDashboardSummary()
  }),
})

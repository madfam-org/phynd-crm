import { VisitorTrackingService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

export const visitorTrackingRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          identified: z.boolean().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      const service = new VisitorTrackingService(ctx)
      return service.list(input)
    }),

  getByContactId: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      const service = new VisitorTrackingService(ctx)
      return service.getByContactId(input.contactId)
    }),

  getAnonymous: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(({ ctx, input }) => {
      const service = new VisitorTrackingService(ctx)
      return service.getAnonymous(input?.limit)
    }),

  identify: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        contactId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new VisitorTrackingService(ctx)
      return service.identifySession(input.sessionId, input.contactId)
    }),

  recordAssetInteraction: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        assetId: z.string(),
        eventType: z.enum(['3d_load', '3d_interact', '3d_rotate', '3d_zoom']),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new VisitorTrackingService(ctx)
      return service.recordPageView({
        sessionId: input.sessionId,
        url: `forj://asset/${input.assetId}/${input.eventType}`,
        title: `3D Asset: ${input.eventType}`,
      })
    }),

  recordPageView: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        url: z.string().url().max(2000),
        title: z.string().max(500).optional(),
        duration: z.number().int().min(0).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new VisitorTrackingService(ctx)
      return service.recordPageView(input)
    }),

  getPageViews: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      const service = new VisitorTrackingService(ctx)
      return service.getPageViews(input.sessionId)
    }),

  metrics: protectedProcedure.query(({ ctx }) => {
    const service = new VisitorTrackingService(ctx)
    return service.getMetrics()
  }),
})

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

  metrics: protectedProcedure.query(({ ctx }) => {
    const service = new VisitorTrackingService(ctx)
    return service.getMetrics()
  }),
})

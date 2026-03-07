import { ConversionsService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

export const conversionsRouter = router({
  record: protectedProcedure
    .input(
      z.object({
        type: z.enum([
          'visitor_to_lead',
          'lead_to_opportunity',
          'opportunity_to_won',
          'offer_redemption',
        ]),
        contactId: z.string().uuid().optional(),
        leadId: z.string().uuid().optional(),
        opportunityId: z.string().uuid().optional(),
        campaignId: z.string().uuid().optional(),
        visitorSessionId: z.string().uuid().optional(),
        value: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new ConversionsService(ctx)
      return service.recordConversion(input)
    }),

  getByEntity: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(['contact', 'lead', 'opportunity']),
        entityId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) => {
      const service = new ConversionsService(ctx)
      return service.getByEntity(input.entityType, input.entityId)
    }),

  funnelMetrics: protectedProcedure.query(({ ctx }) => {
    const service = new ConversionsService(ctx)
    return service.getFunnelMetrics()
  }),
})

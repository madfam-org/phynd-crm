import { isFeatureEnabled } from '@phynd/config/features'
import { CampaignsService } from '@phynd/services'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

function assertFunnelManagement() {
  if (!isFeatureEnabled('funnelManagement')) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Feature not enabled: funnelManagement',
    })
  }
}

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .optional()

export const campaignsRouter = router({
  list: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    assertFunnelManagement()
    const service = new CampaignsService(ctx)
    return service.list(input ?? undefined)
  }),

  getById: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(({ ctx, input }) => {
    assertFunnelManagement()
    const service = new CampaignsService(ctx)
    return service.getById(input.id)
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        channel: z
          .enum(['email', 'social', 'paid_search', 'organic', 'referral', 'direct', 'other'])
          .optional(),
        utmSource: z.string().max(255).optional(),
        utmMedium: z.string().max(255).optional(),
        utmCampaign: z.string().max(255).optional(),
        budget: z.string().optional(),
        currency: z.string().max(3).optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        offerId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      assertFunnelManagement()
      const service = new CampaignsService(ctx)
      return service.create(input)
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        channel: z
          .enum(['email', 'social', 'paid_search', 'organic', 'referral', 'direct', 'other'])
          .optional(),
        status: z.enum(['draft', 'active', 'paused', 'completed']).optional(),
        utmSource: z.string().max(255).optional(),
        utmMedium: z.string().max(255).optional(),
        utmCampaign: z.string().max(255).optional(),
        budget: z.string().optional(),
        spend: z.string().optional(),
        currency: z.string().max(3).optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        offerId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      assertFunnelManagement()
      const { id, ...data } = input
      const service = new CampaignsService(ctx)
      return service.update(id, data)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      assertFunnelManagement()
      const service = new CampaignsService(ctx)
      return service.delete(input.id)
    }),
})

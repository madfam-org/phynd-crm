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
    filters: z
      .object({
        status: z.string().optional(),
        importSource: z.string().optional(),
        gaReadiness: z.string().optional(),
        skuKey: z.string().optional(),
        tulanaOnly: z.boolean().optional(),
      })
      .optional(),
  })
  .optional()

const campaignStatusSchema = z.enum([
  'draft',
  'active',
  'paused',
  'completed',
  'draft_imported',
  'needs_review',
  'approved',
  'scheduled',
  'sent',
  'suppressed',
  'rejected',
])

export const campaignsRouter = router({
  list: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    assertFunnelManagement()
    const service = new CampaignsService(ctx)
    const { filters, ...pagination } = input ?? {}
    return service.list(pagination, filters)
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
        status: campaignStatusSchema.optional(),
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

  reviewTulanaImport: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        decision: z.enum(['approved', 'rejected']),
      }),
    )
    .mutation(({ ctx, input }) => {
      assertFunnelManagement()
      const service = new CampaignsService(ctx)
      return service.reviewTulanaImport(input.id, input.decision)
    }),

  checkSendEligibility: protectedProcedure
    .input(
      z.object({
        campaignId: z.string().uuid(),
        contactId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) => {
      assertFunnelManagement()
      const service = new CampaignsService(ctx)
      return service.getSendEligibility(input.campaignId, input.contactId)
    }),

  attemptTulanaSend: protectedProcedure
    .input(
      z.object({
        campaignId: z.string().uuid(),
        contactId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) => {
      assertFunnelManagement()
      const service = new CampaignsService(ctx)
      return service.attemptTulanaSend(input.campaignId, input.contactId)
    }),
})

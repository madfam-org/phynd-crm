import { isFeatureEnabled } from '@phyne/config/features'
import { ReferralService } from '@phyne/services'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

function assertReferralManagement() {
  if (!isFeatureEnabled('referralManagement')) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Feature not enabled: referralManagement',
    })
  }
}

export const referralsRouter = router({
  getMyCode: protectedProcedure.query(({ ctx }) => {
    assertReferralManagement()
    const service = new ReferralService(ctx)
    return service.getMyCode(ctx.auth.userId)
  }),

  generateCode: protectedProcedure
    .input(
      z.object({
        sourceProduct: z.string().min(1).max(50),
      }),
    )
    .mutation(({ ctx, input }) => {
      assertReferralManagement()
      const service = new ReferralService(ctx)
      return service.generateCode(
        ctx.auth.userId,
        null, // ownerEmail — not available from auth context, can be enriched later
        null, // ownerName — same
        input.sourceProduct,
      )
    }),

  stats: protectedProcedure.query(({ ctx }) => {
    assertReferralManagement()
    const service = new ReferralService(ctx)
    return service.getStats(ctx.auth.userId)
  }),

  list: protectedProcedure
    .input(
      z
        .object({
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      assertReferralManagement()
      const service = new ReferralService(ctx)
      return service.list(input ?? undefined)
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      assertReferralManagement()
      const service = new ReferralService(ctx)
      return service.getById(input.id)
    }),
})

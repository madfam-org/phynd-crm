import { isFeatureEnabled } from '@phynd/config/features'
import { GrantsService } from '@phynd/services'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { entityId } from '../validation'
import { protectedProcedure, router } from '../trpc'

function assertTreasuryHunter() {
  if (!isFeatureEnabled('treasuryHunter')) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Feature not enabled: treasuryHunter',
    })
  }
}

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .optional()

export const grantsRouter = router({
  listOpportunities: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    assertTreasuryHunter()
    const service = new GrantsService(ctx)
    return service.listOpportunities(input ?? undefined)
  }),

  getOpportunity: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      assertTreasuryHunter()
      const service = new GrantsService(ctx)
      return service.getOpportunity(input.id)
    }),

  listApplications: protectedProcedure
    .input(
      z
        .object({
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
          status: z.string().optional(),
          ownerId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      assertTreasuryHunter()
      const { status, ownerId, ...pagination } = input ?? {}
      const service = new GrantsService(ctx)
      return service.listApplications(
        pagination,
        status || ownerId ? { status, ownerId } : undefined,
      )
    }),

  getApplication: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      assertTreasuryHunter()
      const service = new GrantsService(ctx)
      return service.getApplication(input.id)
    }),

  createApplication: protectedProcedure
    .input(
      z.object({
        grantOpportunityId: z.string().uuid(),
        pipelineId: entityId,
        stageId: entityId,
        contactId: z.string().uuid().optional(),
        requestedAmount: z.string().optional(),
        ownerId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      assertTreasuryHunter()
      const service = new GrantsService(ctx)
      return service.createApplication(input)
    }),

  moveToStage: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        stageId: entityId,
      }),
    )
    .mutation(({ ctx, input }) => {
      assertTreasuryHunter()
      const service = new GrantsService(ctx)
      return service.moveToStage(input.id, input.stageId)
    }),

  requestHitlApproval: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      assertTreasuryHunter()
      const service = new GrantsService(ctx)
      return service.requestHitlApproval(input.id)
    }),

  approveSubmission: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        notes: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      assertTreasuryHunter()
      const service = new GrantsService(ctx)
      return service.approveForSubmission(input.id, ctx.auth.userId, input.notes)
    }),

  rejectSubmission: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        notes: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      assertTreasuryHunter()
      const service = new GrantsService(ctx)
      return service.rejectSubmission(input.id, ctx.auth.userId, input.notes)
    }),

  markSubmitted: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      assertTreasuryHunter()
      const service = new GrantsService(ctx)
      return service.markSubmitted(input.id)
    }),

  markAwarded: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        awardedAmount: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      assertTreasuryHunter()
      const service = new GrantsService(ctx)
      return service.markAwarded(input.id, input.awardedAmount)
    }),

  getAuditTrail: protectedProcedure
    .input(
      z.object({
        opportunityId: z.string().uuid().optional(),
        applicationId: z.string().uuid().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      assertTreasuryHunter()
      const service = new GrantsService(ctx)
      return service.getAuditTrail(input.opportunityId, input.applicationId)
    }),

  getPipelineStats: protectedProcedure.query(({ ctx }) => {
    assertTreasuryHunter()
    const service = new GrantsService(ctx)
    return service.getPipelineStats()
  }),
})

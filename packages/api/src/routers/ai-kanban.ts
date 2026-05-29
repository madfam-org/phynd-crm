import { isFeatureEnabled } from '@phynd/config/features'
import { AiKanbanService } from '@phynd/services'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

function assertAiKanban() {
  if (!isFeatureEnabled('aiKanban')) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Feature not enabled: aiKanban',
    })
  }
}

const entityTypeSchema = z.enum(['lead', 'opportunity'])

export const aiKanbanRouter = router({
  listPending: protectedProcedure
    .input(z.object({ pipelineId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      assertAiKanban()
      const service = new AiKanbanService(ctx)
      return service.listPending(input.pipelineId)
    }),

  createSuggestion: protectedProcedure
    .input(
      z.object({
        entityType: entityTypeSchema,
        entityId: z.string().uuid(),
        suggestionType: z.literal('move_stage'),
        title: z.string().min(1).max(255),
        rationale: z.string().max(2000).optional(),
        proposedStageId: z.string().uuid(),
        source: z.string().max(64).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      assertAiKanban()
      const service = new AiKanbanService(ctx)
      return service.createSuggestion(input)
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      assertAiKanban()
      const service = new AiKanbanService(ctx)
      return service.approve(input.id)
    }),

  reject: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      assertAiKanban()
      const service = new AiKanbanService(ctx)
      return service.reject(input.id, input.reason)
    }),
})

import { OpportunitiesService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

export const opportunitiesRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    const service = new OpportunitiesService(ctx)
    return service.list()
  }),

  getById: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(({ ctx, input }) => {
    const service = new OpportunitiesService(ctx)
    return service.getById(input.id)
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        contactId: z.string().uuid().optional(),
        pipelineId: z.string().uuid(),
        stageId: z.string().uuid(),
        value: z.string().optional(),
        probability: z.number().int().min(0).max(100).optional(),
        expectedCloseDate: z.date().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new OpportunitiesService(ctx)
      return service.create(input)
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        stageId: z.string().uuid().optional(),
        value: z.string().optional(),
        probability: z.number().int().min(0).max(100).optional(),
        status: z.enum(['open', 'won', 'lost']).optional(),
        expectedCloseDate: z.date().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input
      const service = new OpportunitiesService(ctx)
      return service.update(id, data)
    }),

  moveToStage: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        stageId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new OpportunitiesService(ctx)
      return service.moveToStage(input.id, input.stageId)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new OpportunitiesService(ctx)
      return service.delete(input.id)
    }),
})

import { PipelinesService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .optional()

export const pipelinesRouter = router({
  list: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    const service = new PipelinesService(ctx)
    return service.list(input ?? undefined)
  }),

  getById: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(({ ctx, input }) => {
    const service = new PipelinesService(ctx)
    return service.getById(input.id)
  }),

  getStages: protectedProcedure
    .input(z.object({ pipelineId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      const service = new PipelinesService(ctx)
      return service.getStages(input.pipelineId)
    }),

  getDefault: protectedProcedure.query(({ ctx }) => {
    const service = new PipelinesService(ctx)
    return service.getDefault()
  }),
})

import { z } from 'zod'
import { PipelinesService } from '@phyne/services'
import { protectedProcedure, router } from '../trpc'

export const pipelinesRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    const service = new PipelinesService(ctx)
    return service.list()
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
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

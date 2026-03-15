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

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new PipelinesService(ctx)
      return service.create(input)
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input
      const service = new PipelinesService(ctx)
      return service.update(id, data)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new PipelinesService(ctx)
      return service.delete(input.id)
    }),

  createStage: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string().uuid(),
        name: z.string().min(1).max(255),
        position: z.number().int().min(0),
        probability: z.number().int().min(0).max(100).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new PipelinesService(ctx)
      return service.createStage(input)
    }),

  updateStage: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        position: z.number().int().min(0).optional(),
        probability: z.number().int().min(0).max(100).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input
      const service = new PipelinesService(ctx)
      return service.updateStage(id, data)
    }),

  deleteStage: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new PipelinesService(ctx)
      return service.deleteStage(input.id)
    }),

  reorderStages: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string().uuid(),
        stageIds: z.array(z.string().uuid()).min(1),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new PipelinesService(ctx)
      return service.reorderStages(input.pipelineId, input.stageIds)
    }),
})

import { LeadsService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .optional()

export const leadsRouter = router({
  list: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    const service = new LeadsService(ctx)
    return service.list(input ?? undefined)
  }),

  getById: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(({ ctx, input }) => {
    const service = new LeadsService(ctx)
    return service.getById(input.id)
  }),

  create: protectedProcedure
    .input(
      z.object({
        contactId: z.string().uuid().optional(),
        externalJanuaId: z.string().optional(),
        source: z.string().max(100).optional(),
        pipelineId: z.string().uuid(),
        stageId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new LeadsService(ctx)
      return service.create(input)
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(['new', 'contacted', 'qualified', 'unqualified', 'converted']).optional(),
        score: z.number().int().min(0).max(100).optional(),
        stageId: z.string().uuid().optional(),
        ownerId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input
      const service = new LeadsService(ctx)
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
      const service = new LeadsService(ctx)
      return service.moveToStage(input.id, input.stageId)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new LeadsService(ctx)
      return service.delete(input.id)
    }),
})

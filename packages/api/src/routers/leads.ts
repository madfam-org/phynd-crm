import { LeadsService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    ownerId: z.string().uuid().optional(),
  })
  .optional()

export const leadsRouter = router({
  list: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    const { ownerId, ...pagination } = input ?? {}
    const service = new LeadsService(ctx)
    return service.list(pagination, ownerId ? { ownerId } : undefined)
  }),

  listMine: protectedProcedure
    .input(
      z
        .object({
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      const service = new LeadsService(ctx)
      return service.list(input ?? undefined, { ownerId: ctx.auth.userId })
    }),

  listByContactId: protectedProcedure
    .input(
      z.object({
        contactId: z.string().uuid(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const { contactId, ...pagination } = input
      const service = new LeadsService(ctx)
      return service.listByContactId(contactId, pagination)
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

  bulkUpdateStatus: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.string().uuid()).min(1),
        status: z.enum(['new', 'contacted', 'qualified', 'unqualified', 'converted']),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new LeadsService(ctx)
      return service.bulkUpdateStatus(input.ids, input.status)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new LeadsService(ctx)
      return service.delete(input.id)
    }),
})

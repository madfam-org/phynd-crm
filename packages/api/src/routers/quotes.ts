import { QuotesService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    ownerId: z.string().uuid().optional(),
  })
  .optional()

export const quotesRouter = router({
  list: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    const { ownerId, ...pagination } = input ?? {}
    const service = new QuotesService(ctx)
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
      const service = new QuotesService(ctx)
      return service.list(input ?? undefined, { ownerId: ctx.auth.userId })
    }),

  listByOpportunityId: protectedProcedure
    .input(
      z.object({
        opportunityId: z.string().uuid(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const { opportunityId, ...pagination } = input
      const service = new QuotesService(ctx)
      return service.listByOpportunityId(opportunityId, pagination)
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
      const service = new QuotesService(ctx)
      return service.listByContactId(contactId, pagination)
    }),

  getById: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(({ ctx, input }) => {
    const service = new QuotesService(ctx)
    return service.getById(input.id)
  }),

  create: protectedProcedure
    .input(
      z.object({
        quoteNumber: z.string().min(1).max(50),
        opportunityId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
        totalAmount: z.string().optional(),
        currency: z.string().max(10).optional(),
        validUntil: z.date().optional(),
        ownerId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new QuotesService(ctx)
      return service.create(input)
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        quoteNumber: z.string().min(1).max(50).optional(),
        totalAmount: z.string().optional(),
        currency: z.string().max(10).optional(),
        status: z.enum(['draft', 'sent', 'accepted', 'declined', 'expired']).optional(),
        validUntil: z.date().optional(),
        ownerId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input
      const service = new QuotesService(ctx)
      return service.update(id, data)
    }),

  accept: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        createOrder: z.boolean().optional(),
        estimatedCompletion: z.date().optional(),
        orderNumber: z.string().min(1).max(50).optional(),
        orderStatus: z.enum(['confirmed', 'in_production']).optional(),
        source: z.enum(['api', 'cotiza', 'crm']).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input
      const service = new QuotesService(ctx)
      return service.accept(id, data)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new QuotesService(ctx)
      return service.delete(input.id)
    }),
})

import { OrdersService } from '@phynd/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    ownerId: z.string().uuid().optional(),
  })
  .optional()

export const ordersRouter = router({
  list: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    const { ownerId, ...pagination } = input ?? {}
    const service = new OrdersService(ctx)
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
      const service = new OrdersService(ctx)
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
      const service = new OrdersService(ctx)
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
      const service = new OrdersService(ctx)
      return service.listByContactId(contactId, pagination)
    }),

  listByQuoteId: protectedProcedure
    .input(
      z.object({
        quoteId: z.string().uuid(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const { quoteId, ...pagination } = input
      const service = new OrdersService(ctx)
      return service.listByQuoteId(quoteId, pagination)
    }),

  getById: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(({ ctx, input }) => {
    const service = new OrdersService(ctx)
    return service.getById(input.id)
  }),

  create: protectedProcedure
    .input(
      z.object({
        orderNumber: z.string().min(1).max(50),
        opportunityId: z.string().uuid().optional(),
        quoteId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
        totalAmount: z.string().optional(),
        currency: z.string().max(10).optional(),
        estimatedCompletion: z.date().optional(),
        ownerId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new OrdersService(ctx)
      return service.create(input)
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        orderNumber: z.string().min(1).max(50).optional(),
        totalAmount: z.string().optional(),
        currency: z.string().max(10).optional(),
        status: z
          .enum(['pending', 'confirmed', 'in_production', 'fulfilled', 'cancelled'])
          .optional(),
        estimatedCompletion: z.date().optional(),
        actualCompletion: z.date().optional(),
        ownerId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input
      const service = new OrdersService(ctx)
      return service.update(id, data)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new OrdersService(ctx)
      return service.delete(input.id)
    }),
})

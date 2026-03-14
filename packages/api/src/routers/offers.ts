import { OffersService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .optional()

export const offersRouter = router({
  list: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    const service = new OffersService(ctx)
    return service.list(input ?? undefined)
  }),

  getById: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(({ ctx, input }) => {
    const service = new OffersService(ctx)
    return service.getById(input.id)
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        type: z.enum(['discount', 'bundle', 'free_trial', 'custom']).optional(),
        value: z.string().optional(),
        currency: z.string().max(3).optional(),
        validFrom: z.date().optional(),
        validUntil: z.date().optional(),
        maxRedemptions: z.number().int().positive().optional(),
        externalProductId: z.string().optional(),
        externalProvider: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new OffersService(ctx)
      return service.create(input)
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        type: z.enum(['discount', 'bundle', 'free_trial', 'custom']).optional(),
        value: z.string().optional(),
        currency: z.string().max(3).optional(),
        validFrom: z.date().optional(),
        validUntil: z.date().optional(),
        maxRedemptions: z.number().int().positive().optional(),
        status: z.enum(['draft', 'active', 'paused', 'expired']).optional(),
        externalProductId: z.string().optional(),
        externalProvider: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input
      const service = new OffersService(ctx)
      return service.update(id, data)
    }),

  redeem: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new OffersService(ctx)
      return service.recordRedemption(input.id)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new OffersService(ctx)
      return service.delete(input.id)
    }),
})

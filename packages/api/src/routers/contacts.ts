import { ContactsService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .optional()

export const contactsRouter = router({
  list: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    const service = new ContactsService(ctx)
    return service.list(input ?? undefined)
  }),

  getById: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(({ ctx, input }) => {
    const service = new ContactsService(ctx)
    return service.getById(input.id)
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        email: z.string().email().optional(),
        phone: z.string().max(50).optional(),
        company: z.string().max(255).optional(),
        externalJanuaId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new ContactsService(ctx)
      return service.create(input)
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        email: z.string().email().nullable().optional(),
        phone: z.string().max(50).nullable().optional(),
        company: z.string().max(255).nullable().optional(),
        status: z.enum(['active', 'inactive', 'archived']).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input
      const service = new ContactsService(ctx)
      return service.update(id, data)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new ContactsService(ctx)
      return service.delete(input.id)
    }),
})

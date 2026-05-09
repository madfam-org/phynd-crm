import { UsersService } from '@phynd/services'
import { z } from 'zod'
import { protectedProcedure, requireRole, router } from '../trpc'

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .optional()

const adminProcedure = protectedProcedure.use(requireRole('admin'))

export const usersRouter = router({
  list: adminProcedure.input(paginationInput).query(({ ctx, input }) => {
    const service = new UsersService(ctx)
    return service.list(input ?? undefined)
  }),

  getById: adminProcedure.input(z.object({ id: z.string().uuid() })).query(({ ctx, input }) => {
    const service = new UsersService(ctx)
    return service.getById(input.id)
  }),

  create: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().max(255).optional(),
        role: z.enum(['admin', 'manager', 'sales_rep', 'viewer']).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new UsersService(ctx)
      return service.create(input)
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        email: z.string().email().optional(),
        name: z.string().max(255).nullable().optional(),
        role: z.enum(['admin', 'manager', 'sales_rep', 'viewer']).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input
      const service = new UsersService(ctx)
      return service.update(id, data)
    }),

  delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ ctx, input }) => {
    const service = new UsersService(ctx)
    return service.delete(input.id)
  }),
})

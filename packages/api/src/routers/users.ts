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

/** Ids that belong to non-Janua principals and must never be linked as a Janua subject. */
const RESERVED_PRINCIPAL = /^(service:|demo-|system$|dev-user$)/

/** A Janua OIDC `sub` (the Janua user id), as stored in `users.external_janua_id`. */
export const januaSubInput = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@|-]*$/, 'Not a valid Janua subject')
  .refine((sub) => !RESERVED_PRINCIPAL.test(sub), 'Reserved principal id, not a Janua subject')

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
        externalJanuaId: januaSubInput.optional(),
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

  linkJanua: adminProcedure
    .input(z.object({ id: z.string().min(1), januaSub: januaSubInput }))
    .mutation(({ ctx, input }) => {
      const service = new UsersService(ctx)
      return service.linkJanua(input.id, input.januaSub)
    }),

  unlinkJanua: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const service = new UsersService(ctx)
      return service.unlinkJanua(input.id)
    }),

  /** The caller's own identity: Janua subject and linked CRM user (any signed-in user). */
  me: protectedProcedure.query(({ ctx }) => ({
    januaSub: ctx.auth.januaSub ?? null,
    crmUserId: ctx.auth.crmUserId ?? null,
    linked: Boolean(ctx.auth.crmUserId),
  })),

  delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ ctx, input }) => {
    const service = new UsersService(ctx)
    return service.delete(input.id)
  }),
})

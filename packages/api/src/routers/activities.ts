import { ActivitiesService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    ownerId: z.string().uuid().optional(),
  })
  .optional()

export const activitiesRouter = router({
  list: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    const { ownerId, ...pagination } = input ?? {}
    const service = new ActivitiesService(ctx)
    return service.listRecent(pagination, ownerId ? { ownerId } : undefined)
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
      const service = new ActivitiesService(ctx)
      return service.listRecent(input ?? undefined, { ownerId: ctx.auth.userId })
    }),

  listForEntity: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(['contact', 'lead', 'opportunity', 'order', 'quote']),
        entityId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) => {
      const service = new ActivitiesService(ctx)
      return service.listForEntity(input.entityType, input.entityId)
    }),

  create: protectedProcedure
    .input(
      z.object({
        type: z.enum(['call', 'email', 'meeting', 'task', 'note']),
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        dueAt: z.date().optional(),
        entityType: z.enum(['contact', 'lead', 'opportunity', 'order', 'quote']),
        entityId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new ActivitiesService(ctx)
      return service.create(input)
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(255).optional(),
        description: z.string().nullable().optional(),
        dueAt: z.date().nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input
      const service = new ActivitiesService(ctx)
      return service.update(id, data)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new ActivitiesService(ctx)
      return service.delete(input.id)
    }),

  complete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new ActivitiesService(ctx)
      return service.complete(input.id)
    }),
})

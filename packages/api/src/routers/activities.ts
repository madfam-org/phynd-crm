import { ActivitiesService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

export const activitiesRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(({ ctx, input }) => {
      const service = new ActivitiesService(ctx)
      return service.listRecent(input?.limit)
    }),

  listForEntity: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(['contact', 'lead', 'opportunity']),
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
        entityType: z.enum(['contact', 'lead', 'opportunity']),
        entityId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new ActivitiesService(ctx)
      return service.create(input)
    }),

  complete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new ActivitiesService(ctx)
      return service.complete(input.id)
    }),
})

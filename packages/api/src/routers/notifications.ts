import { NotificationsService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

export const notificationsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          unreadOnly: z.boolean().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      const service = new NotificationsService(ctx)
      return service.listForUser(ctx.auth.userId, input ?? undefined)
    }),

  unreadCount: protectedProcedure.query(({ ctx }) => {
    const service = new NotificationsService(ctx)
    return service.getUnreadCount(ctx.auth.userId)
  }),

  markAsRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new NotificationsService(ctx)
      return service.markAsRead(input.id)
    }),

  markAllAsRead: protectedProcedure.mutation(({ ctx }) => {
    const service = new NotificationsService(ctx)
    return service.markAllAsRead(ctx.auth.userId)
  }),
})

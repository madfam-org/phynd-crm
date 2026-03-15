import { TimelineService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

export const timelineRouter = router({
  getTimeline: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(['contact', 'lead', 'opportunity', 'order', 'quote']),
        entityId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) => {
      const service = new TimelineService(ctx)
      return service.getTimeline(input.entityType, input.entityId)
    }),
})

import { UnifiedProfileService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

export const unifiedProfileRouter = router({
  getProfile: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      if (!ctx.federation) {
        throw new Error('Federation clients not available in context')
      }
      const service = new UnifiedProfileService(ctx, ctx.federation.clients)
      return service.getProfile(input.contactId, ctx.auth.accessToken)
    }),
})

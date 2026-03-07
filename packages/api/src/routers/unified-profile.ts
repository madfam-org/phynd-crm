import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

// Note: The unified profile router requires federation clients to be injected.
// This is a scaffold — full wiring happens in apps/web when creating the tRPC context.
export const unifiedProfileRouter = router({
  getProfile: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .query(({ input }) => {
      // Placeholder: In production, UnifiedProfileService is instantiated with federation clients
      // wired through the tRPC context factory in apps/web
      return {
        contactId: input.contactId,
        message: 'Federation clients need to be wired in apps/web tRPC context',
      }
    }),
})

import { protectedProcedure, router } from '../trpc'

export const federationHealthRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.federation) {
      throw new Error('Federation health checker not available in context')
    }
    const providers = await ctx.federation.healthChecker.checkAll()
    return { providers }
  }),
})

import { PreferencesService } from '@phynd/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

export const preferencesRouter = router({
  getForRole: protectedProcedure
    .input(z.object({ role: z.string().min(1).max(50) }))
    .query(({ ctx, input }) => {
      const service = new PreferencesService(ctx)
      return service.getForRole(input.role)
    }),

  upsert: protectedProcedure
    .input(
      z.object({
        role: z.string().min(1).max(50),
        panelOrder: z.array(z.string()).optional(),
        defaultTab: z.string().max(100).nullable().optional(),
        visibleColumns: z.record(z.string(), z.array(z.string())).nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new PreferencesService(ctx)
      return service.upsert(input)
    }),
})

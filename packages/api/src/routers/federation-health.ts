import { router, protectedProcedure } from '../trpc'

export const federationHealthRouter = router({
  status: protectedProcedure.query(() => {
    // Placeholder: Wired with ProviderHealthChecker in apps/web
    return {
      providers: [
        { provider: 'janua', status: 'ok', latencyMs: null, lastChecked: new Date(), circuitState: 'closed' },
        { provider: 'dhanam', status: 'ok', latencyMs: null, lastChecked: new Date(), circuitState: 'closed' },
        { provider: 'cotiza', status: 'ok', latencyMs: null, lastChecked: new Date(), circuitState: 'closed' },
        { provider: 'pravara', status: 'ok', latencyMs: null, lastChecked: new Date(), circuitState: 'closed' },
        { provider: 'forj', status: 'ok', latencyMs: null, lastChecked: new Date(), circuitState: 'closed' },
      ],
    }
  }),
})

/**
 * GET /api/v1/convergence/opportunities?period_start=<ISO>&period_end=<ISO>
 *
 * Opportunities open during `[period_start, period_end)` or closed within it,
 * as converge-dash (dash.madfam.io) ingests them. `value` is MXN.
 * Bearer `CONVERGENCE_API_TOKEN`. Contract and mapping: docs/CONVERGENCE_API.md.
 */
import { createConvergenceHandler } from '@/lib/convergence/handler'

export const GET = createConvergenceHandler('opportunities', (service, period) =>
  service.listOpportunities(period),
)

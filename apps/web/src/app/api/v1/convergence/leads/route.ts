/**
 * GET /api/v1/convergence/leads?period_start=<ISO>&period_end=<ISO>
 *
 * Leads captured in `[period_start, period_end)`, as converge-dash
 * (dash.madfam.io) ingests them. Bearer `CONVERGENCE_API_TOKEN`.
 * Contract and mapping: docs/CONVERGENCE_API.md.
 */
import { createConvergenceHandler } from '@/lib/convergence/handler'

export const GET = createConvergenceHandler('leads', (service, period) => service.listLeads(period))

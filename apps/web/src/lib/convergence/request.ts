/**
 * Request-side checks for the convergence read API: bearer auth, the
 * `[period_start, period_end)` window and the tenant scope.
 * Contract and rules: docs/CONVERGENCE_API.md.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { ConvergencePeriod } from '@phynd/services/convergence/convergence-feed'

// ---------------------------------------------------------------------------
// Auth — same shape as Dhanam's ConvergenceAuthGuard
// ---------------------------------------------------------------------------

export type ConvergenceAuthFailure = 'missing_bearer' | 'not_configured' | 'invalid_token'

export const CONVERGENCE_AUTH_MESSAGES: Record<ConvergenceAuthFailure, string> = {
  missing_bearer: 'Missing or malformed Authorization header',
  not_configured: 'Convergence authentication is not configured',
  invalid_token: 'Invalid convergence token',
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * Checks `Authorization: Bearer <token>` against `CONVERGENCE_API_TOKEN`.
 * Fails closed when the token is unset or empty. Both sides are hashed
 * first, so the constant-time comparison never sees different lengths.
 */
export function verifyConvergenceBearer(
  authorization: string | null,
  expectedToken: string | undefined = process.env.CONVERGENCE_API_TOKEN,
): { ok: true } | { ok: false; failure: ConvergenceAuthFailure } {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '')
  const presented = match?.[1]
  if (!presented) return { ok: false, failure: 'missing_bearer' }

  const expected = expectedToken?.trim()
  if (!expected) return { ok: false, failure: 'not_configured' }

  return timingSafeEqual(sha256(presented), sha256(expected))
    ? { ok: true }
    : { ok: false, failure: 'invalid_token' }
}

// ---------------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/

/**
 * ISO-8601 date (`2026-11-01`, UTC midnight) or date-time with an explicit
 * zone (`Z` or `±hh:mm`). A zone-less date-time is rejected: its meaning
 * would depend on the server's clock zone.
 */
export function parseConvergenceInstant(raw: string | null): Date | null {
  if (!raw) return null
  // An unencoded `+hh:mm` offset reaches us as ` hh:mm` after query decoding.
  const value = raw.trim().replace(/ (\d{2}:\d{2})$/, '+$1')
  if (!ISO_DATE.test(value) && !ISO_DATE_TIME.test(value)) return null
  if (!isCalendarDate(value.slice(0, 10))) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time)
}

/** `Date.parse` rolls 2026-02-31 over to March; reject days the month does not have. */
function isCalendarDate(ymd: string): boolean {
  const [year, month, day] = ymd.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function parseConvergencePeriod(
  params: URLSearchParams,
): { ok: true; period: ConvergencePeriod } | { ok: false; error: string } {
  const start = parseConvergenceInstant(params.get('period_start'))
  const end = parseConvergenceInstant(params.get('period_end'))
  if (!start || !end) {
    return {
      ok: false,
      error:
        'period_start and period_end are required ISO-8601 dates or date-times with a zone (e.g. 2026-11-01T00:00:00.000Z)',
    }
  }
  if (start.getTime() >= end.getTime()) {
    return { ok: false, error: 'period_start must be before period_end' }
  }
  return { ok: true, period: { start, end } }
}

// ---------------------------------------------------------------------------
// Tenant scope
// ---------------------------------------------------------------------------

const TENANT_ID = /^[a-z][a-z0-9_]{0,62}$/

/**
 * Tenants whose CRM data feeds the dashboard: `CONVERGENCE_TENANT_IDS`
 * (comma-separated), default `madfam`. Never derived from the request host,
 * so a call through another brand's host (phynd.app) still reads only
 * MADFAM's own CRM. Throws on a malformed list (the route answers 500
 * rather than guess). Tenants that resolve to the same database (a tenant
 * without its own `DATABASE_URL_<TENANT>` falls back to `DATABASE_URL`)
 * are read once.
 */
export function resolveConvergenceTenants(
  resolveDatabaseUrl: (tenantId: string) => string,
  raw: string | undefined = process.env.CONVERGENCE_TENANT_IDS,
): string[] {
  const configured = (raw ?? '').trim()
  const ids = configured ? configured.split(',').map((id) => id.trim()) : ['madfam']
  const invalid = ids.filter((id) => !TENANT_ID.test(id))
  if (invalid.length > 0) {
    throw new Error(`CONVERGENCE_TENANT_IDS has invalid tenant ids: ${JSON.stringify(invalid)}`)
  }

  const seenDatabases = new Set<string>()
  const tenants: string[] = []
  for (const id of ids) {
    const databaseUrl = resolveDatabaseUrl(id)
    if (seenDatabases.has(databaseUrl)) continue
    seenDatabases.add(databaseUrl)
    tenants.push(id)
  }
  return tenants
}

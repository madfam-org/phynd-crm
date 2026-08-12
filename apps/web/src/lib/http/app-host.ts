import { normalizeHost } from '@/lib/branding/tenant-brand'

const AUTHENTICATED_APP_HOSTS = new Set(['crm.madfam.io', 'crm.phynd.app', 'staging-crm.madfam.io'])
const MARKETING_HOSTS = new Set(['phynd.app', 'www.phynd.app'])
export const CANONICAL_PHYND_APP_HOST = 'crm.phynd.app'

/** Hosts that must not serve Auth.js directly — redirect to the CRM app host. */
export const MARKETING_AUTH_REDIRECT_HOSTS = MARKETING_HOSTS

/** Public https origin Auth.js should use for callback/signin URLs on this host. */
export function resolveAuthOriginFromHost(host: string | null | undefined): string {
  const normalized = normalizeHost(host)

  if (normalized === 'crm.madfam.io') return 'https://crm.madfam.io'
  if (normalized === 'crm.phynd.app') return 'https://crm.phynd.app'
  if (normalized === 'staging-crm.madfam.io') return 'https://staging-crm.madfam.io'
  if (MARKETING_HOSTS.has(normalized)) return `https://${CANONICAL_PHYND_APP_HOST}`

  const fallback = process.env.NEXT_PUBLIC_APP_URL ?? `https://${CANONICAL_PHYND_APP_HOST}`
  try {
    return new URL(fallback).origin
  } catch {
    return `https://${CANONICAL_PHYND_APP_HOST}`
  }
}

export function isAuthenticatedAppHost(host: string | null | undefined): boolean {
  return AUTHENTICATED_APP_HOSTS.has(normalizeHost(host))
}

export function getAuthenticatedAppRootRedirect(
  host: string | null | undefined,
  pathname: string,
  isLoggedIn: boolean,
): string | null {
  if (pathname !== '/' || !isAuthenticatedAppHost(host)) return null
  return isLoggedIn ? '/overview' : '/login'
}

export function getCanonicalLoginHost(
  host: string | null | undefined,
  pathname: string,
): string | null {
  if (pathname !== '/login') return null
  return MARKETING_HOSTS.has(normalizeHost(host)) ? CANONICAL_PHYND_APP_HOST : null
}

/**
 * HOLDING REDIRECT (2026-08-12): crm.phynd.app is the app host reserved for
 * external client tenants, and none are live yet — MADFAM ops live fully on
 * crm.madfam.io. Until the first non-MADFAM tenant onboards, browser traffic
 * on crm.phynd.app is 301'd to crm.madfam.io so nobody signs in on a host
 * with no users (stale bookmarks and old emails routed the operator into
 * exactly that — see docs/SSO_LEAD_FLOW_INCIDENT_2026-08-12.md).
 *
 * Deliberately NOT redirected: `/api/*`. Webhook producers and OAuth
 * machinery don't follow redirects (and a 301 downgrades POST to GET), so a
 * blanket redirect would silently break any sender configured against this
 * host. The multi-tenant host architecture stays intact.
 *
 * TO REVERT when the first client tenant goes live: delete this function and
 * its call in middleware.ts (plus its tests).
 */
export function getDormantClientHostRedirect(
  host: string | null | undefined,
  pathname: string,
  search: string,
): string | null {
  if (normalizeHost(host) !== 'crm.phynd.app') return null
  if (pathname.startsWith('/api/')) return null
  return `https://crm.madfam.io${pathname}${search}`
}

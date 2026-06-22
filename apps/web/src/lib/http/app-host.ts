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

import { normalizeHost } from '@/lib/branding/tenant-brand'

const AUTHENTICATED_APP_HOSTS = new Set(['crm.madfam.io', 'crm.phynd.app'])

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

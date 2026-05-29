import { getBrandForHost, normalizeHost } from '@/lib/branding/tenant-brand'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'

function isLocalDevHost(host: string): boolean {
  const withoutPort = host.split(':')[0] ?? host
  return withoutPort === 'localhost' || withoutPort === '127.0.0.1'
}

/**
 * Resolve CRM tenant ID from the incoming request host.
 * Marketing hosts (phynd.app) map to the `phynd` brand; crm.madfam.io → `madfam`.
 * Local dev falls back to DEFAULT_TENANT_ID (`madfam`).
 */
export function resolveTenantIdFromHost(host: string | null | undefined): string {
  const normalized = normalizeHost(host ?? '')
  if (!normalized || isLocalDevHost(normalized)) {
    return DEFAULT_TENANT_ID
  }
  return getBrandForHost(normalized).tenantId
}

export function resolveTenantIdFromHeaders(
  headers: Headers | { get(name: string): string | null },
): string {
  const host =
    headers.get('x-forwarded-host') ?? headers.get('x-original-host') ?? headers.get('host')
  return resolveTenantIdFromHost(host)
}

export type DeploymentTier = 'development' | 'staging' | 'production'

/**
 * Resolves whether this instance may call production MADFAM outbound URLs.
 * Staging must never fan out grant webhooks, engagement projections, or
 * production dispatches to production provider hosts.
 */
export function getDeploymentTier(): DeploymentTier {
  const explicit = process.env.PHYND_DEPLOYMENT_TIER
  if (explicit === 'staging' || explicit === 'production' || explicit === 'development') {
    return explicit
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? '').toLowerCase()
  if (appUrl.includes('localhost') || appUrl.includes('127.0.0.1')) {
    return 'development'
  }
  if (appUrl.includes('staging')) {
    return 'staging'
  }
  return 'production'
}

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Returns true when the URL targets a production MADFAM/provider host that
 * staging must not call.
 */
export function isProductionOutboundHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (!host || host.includes('localhost') || host.includes('127.0.0.1')) {
    return false
  }
  if (host.includes('staging') || host.includes('.staging.')) {
    return false
  }
  if (host.endsWith('.example.com') || host.endsWith('.example')) {
    return false
  }
  if (host === 'phynd.app' || host === 'crm.madfam.io' || host === 'crm.phynd.app') {
    return true
  }
  if (host.endsWith('.madfam.io')) {
    return true
  }
  return false
}

export function isOutboundUrlAllowed(targetUrl: string, _purpose?: string): boolean {
  const tier = getDeploymentTier()
  if (tier !== 'staging') {
    return true
  }
  const hostname = hostnameFromUrl(targetUrl)
  if (!hostname) {
    return false
  }
  return !isProductionOutboundHost(hostname)
}

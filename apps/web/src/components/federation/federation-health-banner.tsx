import type { FederationProviderName } from '@phynd/types/crm'
import type { ProviderStatus } from '@phynd/types/federation'

const PROVIDER_LABELS: Record<FederationProviderName, string> = {
  janua: 'Janua',
  dhanam: 'Dhanam',
  cotiza: 'Cotiza',
  pravara: 'Pravara',
  forj: 'Forj',
  tezca: 'Tezca',
  'janua-telemetry': 'Telemetry',
}

interface FederationHealthBannerProps {
  federationStatus: Partial<Record<FederationProviderName, ProviderStatus>> | undefined
}

export function FederationHealthBanner({ federationStatus }: FederationHealthBannerProps) {
  if (!federationStatus) return null

  const degraded = (
    Object.entries(federationStatus) as [FederationProviderName, ProviderStatus][]
  ).filter(([, status]) => status !== 'ok')

  if (degraded.length === 0) return null

  const labels = degraded
    .map(([provider, status]) => `${PROVIDER_LABELS[provider]} (${status})`)
    .join(', ')

  return (
    <output className="block rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <strong className="font-medium">Live federation incomplete.</strong> {degraded.length}{' '}
      provider{degraded.length === 1 ? '' : 's'} unavailable or degraded: {labels}. Data shown is
      CRM-native only unless a provider tab reports cached results.
    </output>
  )
}

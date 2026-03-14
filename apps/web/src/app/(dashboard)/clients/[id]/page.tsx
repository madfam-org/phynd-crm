import { Badge } from '@/components/ui/badge'
import { getServerCaller } from '@/lib/trpc/server'
import { isFeatureEnabled } from '@phyne/config/features'
import type { FederationProviderName } from '@phyne/types/crm'
import type { ProviderStatus } from '@phyne/types/federation'
import { FederationTabs } from './federation-tabs'

interface ClientProfilePageProps {
  params: Promise<{ id: string }>
}

interface FederationPanelConfig {
  provider: FederationProviderName
  title: string
  tabLabel: string
  tabValue: string
  status: ProviderStatus
  data: unknown
  error: string | null
  cachedAt: Date | null
}

type ServerCaller = Awaited<ReturnType<typeof getServerCaller>>
type UnifiedProfile = Awaited<ReturnType<ServerCaller['unifiedProfile']['getProfile']>>

interface ProviderDataSlice {
  data?: unknown
  error?: string | null
  cachedAt?: Date | null
}

interface PanelDescriptor {
  provider: FederationProviderName
  title: string
  tabLabel: string
  tabValue: string
  statusKey: keyof NonNullable<UnifiedProfile['federationStatus']>
  dataKey: keyof UnifiedProfile
  featureFlag?: string
}

const PANEL_DESCRIPTORS: PanelDescriptor[] = [
  {
    provider: 'janua',
    title: 'Identity',
    tabLabel: 'Identity',
    tabValue: 'identity',
    statusKey: 'janua',
    dataKey: 'identity',
  },
  {
    provider: 'dhanam',
    title: 'Billing',
    tabLabel: 'Billing',
    tabValue: 'billing',
    statusKey: 'dhanam',
    dataKey: 'billing',
  },
  {
    provider: 'cotiza',
    title: 'Custom Orders',
    tabLabel: 'Orders',
    tabValue: 'orders',
    statusKey: 'cotiza',
    dataKey: 'manufacturing',
  },
  {
    provider: 'pravara',
    title: 'Fabrication',
    tabLabel: 'Fabrication',
    tabValue: 'fabrication',
    statusKey: 'pravara',
    dataKey: 'fabrication',
  },
  {
    provider: 'forj',
    title: 'Assets',
    tabLabel: 'Assets',
    tabValue: 'assets',
    statusKey: 'forj',
    dataKey: 'assets',
    featureFlag: 'forjEnabled',
  },
]

function resolveProviderSlice(
  profile: UnifiedProfile | null,
  dataKey: keyof UnifiedProfile,
): ProviderDataSlice {
  const slice = profile?.[dataKey]
  if (slice && typeof slice === 'object' && 'data' in slice) {
    return slice as ProviderDataSlice
  }
  return {}
}

function resolveProviderStatus(
  profile: UnifiedProfile | null,
  statusKey: keyof NonNullable<UnifiedProfile['federationStatus']>,
): ProviderStatus {
  return profile?.federationStatus?.[statusKey] ?? 'unavailable'
}

function buildFederationPanels(profile: UnifiedProfile | null): FederationPanelConfig[] {
  return PANEL_DESCRIPTORS.filter((desc) => {
    if (!desc.featureFlag) return true
    return isFeatureEnabled(desc.featureFlag as Parameters<typeof isFeatureEnabled>[0])
  }).map((desc) => {
    const slice = resolveProviderSlice(profile, desc.dataKey)
    return {
      provider: desc.provider,
      title: desc.title,
      tabLabel: desc.tabLabel,
      tabValue: desc.tabValue,
      status: resolveProviderStatus(profile, desc.statusKey),
      data: slice.data ?? null,
      error: slice.error ?? null,
      cachedAt: slice.cachedAt ?? null,
    }
  })
}

export default async function ClientProfilePage({ params }: ClientProfilePageProps) {
  const { id } = await params
  const caller = await getServerCaller()

  let profile: UnifiedProfile | null = null
  let profileError: string | null = null

  try {
    profile = await caller.unifiedProfile.getProfile({ contactId: id })
  } catch (err) {
    profileError = err instanceof Error ? err.message : 'Failed to load profile'
  }

  const contact = profile?.contact
  const panels = buildFederationPanels(profile)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Client Profile</h1>
        <p className="text-muted-foreground">Unified view across all systems</p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        {contact ? (
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{contact.name}</h2>
              <p className="text-sm text-muted-foreground">
                {contact.email} {contact.company && `| ${contact.company}`}
              </p>
            </div>
            <Badge variant={contact.status === 'active' ? 'success' : 'secondary'}>
              {contact.status}
            </Badge>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{profileError ?? `Contact ID: ${id}`}</p>
        )}
      </div>

      <FederationTabs panels={panels} />
    </div>
  )
}

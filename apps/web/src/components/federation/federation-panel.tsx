'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { FederationProviderName } from '@phynd/types/crm'
import type {
  CotizaManufacturing,
  DhanamBilling,
  ForjAssets,
  JanuaIdentity,
  JanuaTelemetry,
  PravaraFabrication,
  ProviderStatus,
} from '@phynd/types/federation'
import { AssetsPanel } from './assets-panel'
import { BillingPanel } from './billing-panel'
import { FabricationPanel } from './fabrication-panel'
import { IdentityPanel } from './identity-panel'
import { ManufacturingPanel } from './manufacturing-panel'
import { TelemetryPanel } from './telemetry-panel'

const providerLabels: Record<FederationProviderName, string> = {
  janua: 'Janua Identity',
  dhanam: 'Dhanam Billing',
  cotiza: 'Cotiza Studio',
  pravara: 'PravaraMES',
  forj: 'Forj Digital Assets',
  tezca: 'Tezca Legal Oracle',
  'janua-telemetry': 'Visitor Telemetry',
}

const statusBadgeVariant: Record<ProviderStatus, 'success' | 'warning' | 'error'> = {
  ok: 'success',
  degraded: 'warning',
  unavailable: 'error',
}

interface FederationPanelProps {
  provider: FederationProviderName
  title: string
  status: ProviderStatus
  data: unknown
  error: string | null
  cachedAt: Date | null
}

export function FederationPanel({
  provider,
  title,
  status,
  data,
  error,
  cachedAt,
}: FederationPanelProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="flex items-center gap-2">
          {cachedAt && (
            <span className="text-xs text-muted-foreground">
              cached {new Date(cachedAt).toLocaleTimeString()}
            </span>
          )}
          <Badge variant={statusBadgeVariant[status]}>{status}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {status === 'unavailable' && !data ? (
          <p className="text-sm text-muted-foreground">
            {error ?? `Unable to load data from ${providerLabels[provider]}`}
          </p>
        ) : data ? (
          <ProviderContent provider={provider} data={data} />
        ) : (
          <p className="text-sm text-muted-foreground">No data available.</p>
        )}
      </CardContent>
    </Card>
  )
}

function ProviderContent({
  provider,
  data,
}: {
  provider: FederationProviderName
  data: unknown
}) {
  switch (provider) {
    case 'janua':
      return <IdentityPanel data={data as JanuaIdentity} />
    case 'dhanam':
      return <BillingPanel data={data as DhanamBilling} />
    case 'cotiza':
      return <ManufacturingPanel data={data as CotizaManufacturing} />
    case 'pravara':
      return <FabricationPanel data={data as PravaraFabrication} />
    case 'forj':
      return <AssetsPanel data={data as ForjAssets} />
    case 'janua-telemetry':
      return <TelemetryPanel data={data as JanuaTelemetry} />
    default:
      return <p className="text-sm text-muted-foreground">Provider display not available.</p>
  }
}

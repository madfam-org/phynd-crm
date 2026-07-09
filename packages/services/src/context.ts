import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import type { Database } from '@phynd/db'
import type { CacheManagerLike, FederationClient, ProviderHealthChecker } from '@phynd/federation'
import type { AuthContext } from '@phynd/types/auth'
import type {
  CotizaManufacturing,
  DhanamBilling,
  ForjAssets,
  JanuaIdentity,
  JanuaTelemetry,
  PravaraFabrication,
} from '@phynd/types/federation'

export interface FederationClients {
  januaClient: FederationClient<unknown, JanuaIdentity>
  dhanamClient: FederationClient<unknown, DhanamBilling>
  cotizaClient: FederationClient<unknown, CotizaManufacturing>
  pravaraClient: FederationClient<unknown, PravaraFabrication>
  forjClient: FederationClient<unknown, ForjAssets>
  januaTelemetryClient: FederationClient<unknown, JanuaTelemetry>
}

export interface ServiceContext {
  db: Database
  cache: CacheManagerLike
  auth: AuthContext
  tenantId: string
  federation?: {
    clients: FederationClients
    healthChecker: ProviderHealthChecker
  }
}

export function createServiceContext(
  db: Database,
  cache: CacheManagerLike,
  auth: AuthContext,
  tenantId?: string,
): ServiceContext {
  const resolvedTenantId = tenantId || (auth as any).tenantId || DEFAULT_TENANT_ID
  return {
    db,
    cache,
    auth,
    tenantId: resolvedTenantId,
  }
}

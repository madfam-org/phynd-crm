import type { Database } from '@phyne/db'
import type { CacheManager, FederationClient, ProviderHealthChecker } from '@phyne/federation'
import type { AuthContext } from '@phyne/types/auth'
import type {
  CotizaManufacturing,
  DhanamBilling,
  ForjAssets,
  JanuaIdentity,
  JanuaTelemetry,
  PravaraFabrication,
} from '@phyne/types/federation'

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
  cache: CacheManager
  auth: AuthContext
  tenantId: string
  federation?: {
    clients: FederationClients
    healthChecker: ProviderHealthChecker
  }
}

export function createServiceContext(
  db: Database,
  cache: CacheManager,
  auth: AuthContext,
): ServiceContext {
  return {
    db,
    cache,
    auth,
    // Single-tenant for MVP Phase 1, extracted from JWT/subdomain in Phase 3
    tenantId: 'madfam',
  }
}

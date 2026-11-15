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

/** The handle `db.transaction(async (tx) => …)` passes to its callback. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * The same context with every service query running on `tx`, so several
 * services can share one transaction. A service's own `db.transaction(…)`
 * then opens a savepoint inside it. A Drizzle transaction exposes the same
 * query API as the database; it only lacks the pool handle (`$client`), which
 * services do not use.
 */
export function withTransaction(ctx: ServiceContext, tx: Transaction): ServiceContext {
  return { ...ctx, db: tx as unknown as Database }
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

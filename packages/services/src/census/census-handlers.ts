import type { Database } from '@phynd/db'
import type { CacheManagerLike } from '@phynd/federation'
import { tenantDatabaseEnv } from './census-config'
import type { CensusEventHandlers } from './census-event-consumer'
import { applyCensusOptOut, applyCensusPickHandoff } from './census-handoff'
import { createCensusTenantStore } from './census-tenant-store'

/** `getDb()` treats this id as the default database. */
const BUILT_IN_DEFAULT_TENANT = 'madfam'

export interface CensusHandlerDeps {
  /** `getDb` from `@phynd/db`: the database of a tenant. */
  getDb: (tenantId: string) => Database
  cache: CacheManagerLike
  logger: { warn(fields: Record<string, unknown>, message: string): void }
  defaultTenantId: string
  /** Defaults to `process.env`. */
  env?: Record<string, string | undefined>
}

/**
 * The consumer's handlers on the CRM database: each event runs in the mapped
 * tenant's own database. A tenant is refused before any query when it is the
 * default tenant or has no `DATABASE_URL_<TENANT>` of its own, because
 * `getDb()` would otherwise fall back to the default database. The start-up
 * configuration check refuses the same tenants; this is the second line.
 */
export function createCensusEventHandlers(deps: CensusHandlerDeps): CensusEventHandlers {
  const env = deps.env ?? process.env
  const storeFor = (tenantId: string) => {
    if (
      tenantId === deps.defaultTenantId ||
      tenantId === BUILT_IN_DEFAULT_TENANT ||
      !env[tenantDatabaseEnv(tenantId)]?.trim()
    ) {
      throw new Error(`census tenant ${tenantId} has no database of its own`)
    }
    return createCensusTenantStore({
      db: deps.getDb(tenantId),
      cache: deps.cache,
      tenantId,
      logger: deps.logger,
      env,
    })
  }
  return {
    // async, so a refused tenant is a rejected promise like any other failure.
    pickHandedOff: async (tenantId, event) => applyCensusPickHandoff(storeFor(tenantId), event),
    optOutCompleted: async (tenantId, event) => applyCensusOptOut(storeFor(tenantId), event),
  }
}

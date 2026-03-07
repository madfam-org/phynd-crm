import type { Database } from '@phyne/db'
import type { CacheManager } from '@phyne/federation'
import type { AuthContext } from '@phyne/types/auth'

export interface ServiceContext {
  db: Database
  cache: CacheManager
  auth: AuthContext
  tenantId: string
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

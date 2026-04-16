import { getEnvUnsafe } from './env'

/**
 * Default tenant identifier.
 * Hardcoded to 'madfam' for Phase 1 single-tenant operation.
 * In Phase 3 (multi-tenancy), this will be extracted from JWT/subdomain
 * and DEFAULT_TENANT_ID will serve only as the fallback.
 */
export const DEFAULT_TENANT_ID = getEnvUnsafe().DEFAULT_TENANT_ID ?? 'madfam'

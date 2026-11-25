/**
 * Configuration of the creator-census consumer, read from the environment.
 *
 * - `PHYND_CRM_CENSUS_CONSUMER_ENABLED`: the consumer runs only when it is
 *   exactly `true`. Off by default.
 * - `PHYND_CRM_CENSUS_ORG_TENANTS`: the explicit allowlist that maps an
 *   agency's Janua organization id to a CRM tenant, `<org_id>=<tenant_id>`
 *   pairs separated by commas. An organization that is not listed is never
 *   written anywhere. A tenant here is a separate database
 *   (`DATABASE_URL_<TENANT>`): the CRM keeps no tenant column, and `getDb()`
 *   falls back to the default database when a tenant's URL is missing, so a
 *   listed tenant must have its own URL, different from `DATABASE_URL`, and
 *   can never be the default tenant.
 * - `PHYND_CRM_CENSUS_REDIS_URL`: the bus's Redis, when it is not the worker's
 *   own `REDIS_URL`.
 *
 * Any malformed value is an error that names the variable, and the consumer
 * does not start: a mapping that cannot be trusted must not write data.
 */

export const CENSUS_CONSUMER_ENABLED_ENV = 'PHYND_CRM_CENSUS_CONSUMER_ENABLED'
export const CENSUS_ORG_TENANTS_ENV = 'PHYND_CRM_CENSUS_ORG_TENANTS'
export const CENSUS_REDIS_URL_ENV = 'PHYND_CRM_CENSUS_REDIS_URL'

/** Same shape the per-tenant database variable can be built from. */
const TENANT_ID = /^[a-z][a-z0-9_]{0,62}$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it rejects
const ORG_ID = /^[^\s,=\u0000-\u001F\u007F]{1,255}$/
/** `getDb()` and `resolveDatabaseUrl()` treat this id as the default database. */
const BUILT_IN_DEFAULT_TENANT = 'madfam'

export class CensusConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CensusConfigError'
  }
}

export interface CensusConsumerConfig {
  enabled: true
  /** Janua organization id → CRM tenant id. */
  orgTenants: ReadonlyMap<string, string>
  /** The bus Redis URL, or `undefined` for the worker's own `REDIS_URL`. */
  redisUrl: string | undefined
}

export type CensusConsumerSettings = { enabled: false } | CensusConsumerConfig

type Env = Record<string, string | undefined>

/** The environment variable that holds a tenant's own database URL. */
export function tenantDatabaseEnv(tenantId: string): string {
  return `DATABASE_URL_${tenantId.toUpperCase()}`
}

function parseEntry(entry: string, position: string): [orgId: string, tenantId: string] {
  const separator = entry.indexOf('=')
  if (separator <= 0 || separator !== entry.lastIndexOf('=')) {
    throw new CensusConfigError(`${position} is not <org_id>=<tenant_id>`)
  }
  const orgId = entry.slice(0, separator).trim()
  const tenantId = entry.slice(separator + 1).trim()
  if (!ORG_ID.test(orgId)) throw new CensusConfigError(`${position}: org id is malformed`)
  if (!TENANT_ID.test(tenantId)) {
    throw new CensusConfigError(
      `${position}: tenant id must be lower case letters, digits or _, starting with a letter`,
    )
  }
  return [orgId, tenantId]
}

/** Never the default tenant; always a database of its own. */
function checkTenant(tenantId: string, position: string, env: Env, defaultTenantId: string): void {
  if (tenantId === defaultTenantId || tenantId === BUILT_IN_DEFAULT_TENANT) {
    throw new CensusConfigError(
      `${position}: the default tenant is never a census tenant; map the organization to its own tenant`,
    )
  }
  const tenantUrl = (env[tenantDatabaseEnv(tenantId)] ?? '').trim()
  if (!tenantUrl) {
    throw new CensusConfigError(
      `${position}: ${tenantDatabaseEnv(tenantId)} is not set (the tenant needs its own database)`,
    )
  }
  if (tenantUrl === (env.DATABASE_URL ?? '').trim()) {
    throw new CensusConfigError(
      `${position}: ${tenantDatabaseEnv(tenantId)} is the default database (DATABASE_URL)`,
    )
  }
}

/**
 * Parses the allowlist. Every entry must be `<org_id>=<tenant_id>`; an org
 * listed twice, the default tenant, or a tenant without its own database URL
 * is refused.
 */
export function parseCensusOrgTenants(
  raw: string | undefined,
  env: Env,
  defaultTenantId: string,
): Map<string, string> {
  const map = new Map<string, string>()
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')

  for (const [index, entry] of entries.entries()) {
    const position = `${CENSUS_ORG_TENANTS_ENV} entry ${index + 1}`
    const [orgId, tenantId] = parseEntry(entry, position)
    checkTenant(tenantId, position, env, defaultTenantId)
    if (map.has(orgId)) throw new CensusConfigError(`${position}: organization listed twice`)
    map.set(orgId, tenantId)
  }
  return map
}

function readRedisUrl(env: Env): string | undefined {
  const raw = (env[CENSUS_REDIS_URL_ENV] ?? '').trim()
  if (!raw) return undefined
  let protocol: string
  try {
    protocol = new URL(raw).protocol
  } catch {
    throw new CensusConfigError(`${CENSUS_REDIS_URL_ENV} is set but is not a valid URL`)
  }
  if (protocol !== 'redis:' && protocol !== 'rediss:') {
    throw new CensusConfigError(`${CENSUS_REDIS_URL_ENV} must be a redis:// or rediss:// URL`)
  }
  return raw
}

/**
 * `{ enabled: false }` unless `PHYND_CRM_CENSUS_CONSUMER_ENABLED` is exactly
 * `true`; otherwise the validated configuration, or a `CensusConfigError`.
 */
export function readCensusConsumerSettings(
  env: Env,
  defaultTenantId: string,
): CensusConsumerSettings {
  if (env[CENSUS_CONSUMER_ENABLED_ENV] !== 'true') return { enabled: false }
  return {
    enabled: true,
    orgTenants: parseCensusOrgTenants(env[CENSUS_ORG_TENANTS_ENV], env, defaultTenantId),
    redisUrl: readRedisUrl(env),
  }
}

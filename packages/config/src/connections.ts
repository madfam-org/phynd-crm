/**
 * Validating resolvers for infrastructure connection URLs.
 *
 * These exist because the raw `process.env.X ?? fallback` pattern has two
 * production failure modes observed live on 2026-07-09:
 *
 * 1. An empty-string env value (a common ESO/Vault sync artifact) passes `??`
 *    and reaches `new Redis('')` / `postgres('')`, which throw a bare
 *    `TypeError: Invalid URL` with no hint of WHICH variable is broken.
 * 2. A malformed value (stray quote, trailing newline) does the same.
 *
 * Both resolvers therefore trim, treat empty as unset, validate the scheme,
 * and throw an error that NAMES the variable. In production a missing value
 * fails loud instead of silently falling back to localhost.
 */

const DEFAULT_REDIS_URL = 'redis://localhost:6379'

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

function validateUrl(raw: string, varName: string, allowedProtocols: string[]): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(
      `${varName} is set but is not a valid URL (check the secret store for empty values, quotes, or whitespace)`,
    )
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(
      `${varName} has unsupported protocol "${parsed.protocol}" (expected one of: ${allowedProtocols.join(', ')})`,
    )
  }
  return raw
}

/**
 * Resolve and validate REDIS_URL. Empty/whitespace values count as unset.
 * Production: throws when unset. Development/test: falls back to localhost.
 */
export function resolveRedisUrl(): string {
  const raw = (process.env.REDIS_URL ?? '').trim()
  if (!raw) {
    if (isProduction()) {
      throw new Error('REDIS_URL is required in production but is unset or empty')
    }
    return DEFAULT_REDIS_URL
  }
  return validateUrl(raw, 'REDIS_URL', ['redis:', 'rediss:'])
}

/**
 * Resolve and validate a Postgres connection URL for a tenant.
 * Returns the validated URL string; throws a named error when missing or
 * malformed. `envVarName` is reported so operators know which variable to fix.
 */
export function resolveDatabaseUrl(tenantId = 'madfam'): string {
  let varName = 'DATABASE_URL'
  let raw = (process.env.DATABASE_URL ?? '').trim()

  if (tenantId !== 'madfam') {
    const tenantVar = `DATABASE_URL_${tenantId.toUpperCase()}`
    const tenantRaw = (process.env[tenantVar] ?? '').trim()
    if (tenantRaw) {
      varName = tenantVar
      raw = tenantRaw
    } else {
      console.warn(
        `No specific DATABASE_URL found for tenant ${tenantId}, falling back to default.`,
      )
    }
  }

  if (!raw) {
    throw new Error(`${varName} is required but is unset or empty`)
  }
  return validateUrl(raw, varName, ['postgres:', 'postgresql:'])
}

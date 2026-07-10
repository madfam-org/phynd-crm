import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveDatabaseUrl, resolveRedisUrl } from '../connections'

describe('resolveRedisUrl', () => {
  beforeEach(() => {
    delete process.env.REDIS_URL
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.REDIS_URL
  })

  it('returns a valid configured URL', () => {
    vi.stubEnv('REDIS_URL', 'redis://cache.internal:6379')
    expect(resolveRedisUrl()).toBe('redis://cache.internal:6379')
  })

  it('accepts rediss:// (TLS)', () => {
    vi.stubEnv('REDIS_URL', 'rediss://cache.internal:6380')
    expect(resolveRedisUrl()).toBe('rediss://cache.internal:6380')
  })

  it('falls back to localhost outside production when unset', () => {
    vi.stubEnv('NODE_ENV', 'test')
    expect(resolveRedisUrl()).toBe('redis://localhost:6379')
  })

  it('treats an empty-string value as unset (ESO/Vault sync artifact)', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('REDIS_URL', '')
    expect(resolveRedisUrl()).toBe('redis://localhost:6379')
  })

  it('treats a whitespace-only value as unset', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('REDIS_URL', '  \n')
    expect(resolveRedisUrl()).toBe('redis://localhost:6379')
  })

  it('throws a named error in production when unset or empty', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('REDIS_URL', '')
    expect(() => resolveRedisUrl()).toThrow(/REDIS_URL is required in production/)
  })

  it('throws a named error for a malformed value instead of a bare Invalid URL', () => {
    vi.stubEnv('REDIS_URL', '"redis://quoted:6379"')
    expect(() => resolveRedisUrl()).toThrow(/REDIS_URL is set but is not a valid URL/)
  })

  it('rejects non-redis protocols', () => {
    vi.stubEnv('REDIS_URL', 'https://not-redis.example.com')
    expect(() => resolveRedisUrl()).toThrow(/unsupported protocol/)
  })
})

describe('resolveDatabaseUrl', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL
    delete process.env.DATABASE_URL_ACME
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.DATABASE_URL
    delete process.env.DATABASE_URL_ACME
  })

  it('returns a valid default-tenant URL', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://user:pw@db.internal:5432/phynd')
    expect(resolveDatabaseUrl('madfam')).toBe('postgres://user:pw@db.internal:5432/phynd')
  })

  it('accepts the postgresql:// scheme', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pw@db.internal:5432/phynd')
    expect(resolveDatabaseUrl()).toBe('postgresql://user:pw@db.internal:5432/phynd')
  })

  it('prefers a tenant-specific URL when set', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://db/main')
    vi.stubEnv('DATABASE_URL_ACME', 'postgres://db/acme')
    expect(resolveDatabaseUrl('acme')).toBe('postgres://db/acme')
  })

  it('falls back to the default URL when the tenant-specific one is unset', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://db/main')
    expect(resolveDatabaseUrl('acme')).toBe('postgres://db/main')
  })

  it('throws naming DATABASE_URL when unset', () => {
    expect(() => resolveDatabaseUrl()).toThrow(/DATABASE_URL is required but is unset or empty/)
  })

  it('throws naming DATABASE_URL when empty (ESO/Vault sync artifact)', () => {
    vi.stubEnv('DATABASE_URL', '')
    expect(() => resolveDatabaseUrl()).toThrow(/DATABASE_URL is required but is unset or empty/)
  })

  it('names the tenant env var when the tenant value is malformed', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://db/main')
    vi.stubEnv('DATABASE_URL_ACME', 'not-a-url')
    expect(() => resolveDatabaseUrl('acme')).toThrow(
      /DATABASE_URL_ACME is set but is not a valid URL/,
    )
  })

  it('rejects non-postgres protocols', () => {
    vi.stubEnv('DATABASE_URL', 'mysql://db/main')
    expect(() => resolveDatabaseUrl()).toThrow(/unsupported protocol/)
  })
})

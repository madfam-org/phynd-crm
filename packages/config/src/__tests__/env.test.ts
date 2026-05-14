import { afterEach, describe, expect, it, vi } from 'vitest'

const baseEnv = {
  DATABASE_URL: 'postgres://phynd:secret@localhost:5432/phynd',
  REDIS_URL: 'redis://localhost:6379/0',
  AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  AUTH_JANUA_ISSUER: 'https://auth.madfam.io',
  AUTH_JANUA_CLIENT_ID: 'janua-client',
  AUTH_JANUA_CLIENT_SECRET: 'janua-secret',
  JANUA_API_URL: 'https://auth.madfam.io',
  JANUA_TELEMETRY_API_URL: 'https://auth.madfam.io/telemetry',
  DHANAM_API_URL: 'https://api.dhan.am',
  COTIZA_API_URL: 'https://api.cotiza.studio',
  PRAVARA_BASE_URL: 'https://mes-api.madfam.io',
  FORJ_API_URL: 'https://forj.design',
  NODE_ENV: 'production',
}

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe('getEnv', () => {
  it('allows Phynd to boot without a Pravara API key', async () => {
    process.env = { ...originalEnv, ...baseEnv }
    delete process.env.PRAVARA_API_KEY
    vi.resetModules()

    const { getEnv } = await import('../env')

    expect(getEnv().PRAVARA_API_KEY).toBeUndefined()
  })

  it('still rejects an explicitly empty Pravara API key', async () => {
    process.env = { ...originalEnv, ...baseEnv, PRAVARA_API_KEY: '' }
    vi.resetModules()

    const { getEnv } = await import('../env')

    expect(() => getEnv()).toThrow(/PRAVARA_API_KEY/)
  })
})

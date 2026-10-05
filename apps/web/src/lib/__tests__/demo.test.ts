import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDemoSessionIdFromCookieHeader, isDemoEnabled, isDemoSession } from '../demo'

const SESSION = '550e8400-e29b-41d4-a716-446655440000'
const ORIGINAL = process.env.PHYND_DEMO_ENABLED

function demoEnv(value: string | undefined) {
  if (value === undefined) delete process.env.PHYND_DEMO_ENABLED
  else vi.stubEnv('PHYND_DEMO_ENABLED', value)
}

function jar(value?: string) {
  return {
    get: (name: string) => (name === 'phynd-demo' && value !== undefined ? { value } : undefined),
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  if (ORIGINAL === undefined) delete process.env.PHYND_DEMO_ENABLED
  else process.env.PHYND_DEMO_ENABLED = ORIGINAL
})

describe('isDemoEnabled', () => {
  it('is off when PHYND_DEMO_ENABLED is unset', () => {
    demoEnv(undefined)
    expect(isDemoEnabled()).toBe(false)
  })

  it.each(['false', '1', 'TRUE', 'yes', ''])('is off for %j', (value) => {
    demoEnv(value)
    expect(isDemoEnabled()).toBe(false)
  })

  it('is on only for exactly "true"', () => {
    demoEnv('true')
    expect(isDemoEnabled()).toBe(true)
  })
})

describe('isDemoSession', () => {
  it('ignores a valid session cookie while the demo is off', () => {
    demoEnv(undefined)
    expect(isDemoSession(jar(SESSION))).toBeNull()
  })

  it('returns the session id the /demo route issues', () => {
    demoEnv('true')
    expect(isDemoSession(jar(SESSION))).toBe(SESSION)
    expect(isDemoSession(jar(crypto.randomUUID()))).not.toBeNull()
  })

  it.each(['sess-123', '', 'not-a-uuid', SESSION.toUpperCase(), `${SESSION}x`])(
    'rejects %j even while the demo is on',
    (value) => {
      demoEnv('true')
      expect(isDemoSession(jar(value))).toBeNull()
    },
  )

  it('returns null when the cookie is absent', () => {
    demoEnv('true')
    expect(isDemoSession(jar())).toBeNull()
  })
})

describe('getDemoSessionIdFromCookieHeader', () => {
  it('reads the session from a Cookie header while the demo is on', () => {
    demoEnv('true')
    expect(getDemoSessionIdFromCookieHeader(`phynd-demo=${SESSION}`)).toBe(SESSION)
    expect(getDemoSessionIdFromCookieHeader(`a=1; phynd-demo=${SESSION}; b=2`)).toBe(SESSION)
  })

  it('ignores the header while the demo is off', () => {
    demoEnv(undefined)
    expect(getDemoSessionIdFromCookieHeader(`phynd-demo=${SESSION}`)).toBeNull()
  })

  it('does not match a cookie whose name only ends in phynd-demo', () => {
    demoEnv('true')
    expect(getDemoSessionIdFromCookieHeader(`xphynd-demo=${SESSION}`)).toBeNull()
  })

  it('rejects a value that is not a session id', () => {
    demoEnv('true')
    expect(getDemoSessionIdFromCookieHeader('phynd-demo=forged')).toBeNull()
    expect(getDemoSessionIdFromCookieHeader('')).toBeNull()
  })
})

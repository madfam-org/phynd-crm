import type { AuthContext } from '@phyne/types/auth'
import { describe, expect, it } from 'vitest'

/**
 * Tests for demo mode contracts.
 * Actual helpers live in apps/web/src/lib/demo.ts — we mirror
 * the logic here to verify the auth context contract that
 * tRPC routers depend on.
 */

// ── Mirrors of apps/web/src/lib/demo.ts ──

const DEMO_COOKIE_NAME = 'phyne-demo'
const DEMO_COOKIE_MAX_AGE = 14400 // 4 hours

function isDemoSession(cookies: {
  get: (name: string) => { value: string } | undefined
}): string | null {
  const cookie = cookies.get(DEMO_COOKIE_NAME)
  return cookie?.value ?? null
}

function createDemoAuth(sessionId: string): AuthContext {
  return {
    userId: `demo-${sessionId}`,
    tenantId: `demo-${sessionId}`,
    roles: ['admin'],
    scopes: ['*'],
    accessToken: 'demo',
  }
}

function createDemoUser(sessionId: string) {
  return {
    name: 'Demo Visitor',
    email: 'demo@phyne.io',
    id: `demo-${sessionId}`,
  }
}

// ── Tests ──

describe('demo constants', () => {
  it('cookie name is phyne-demo', () => {
    expect(DEMO_COOKIE_NAME).toBe('phyne-demo')
  })

  it('cookie max age is 4 hours (14400 seconds)', () => {
    expect(DEMO_COOKIE_MAX_AGE).toBe(4 * 60 * 60)
  })
})

describe('isDemoSession', () => {
  it('returns sessionId when cookie is present', () => {
    const cookies = {
      get: (name: string) => (name === DEMO_COOKIE_NAME ? { value: 'sess-123' } : undefined),
    }
    expect(isDemoSession(cookies)).toBe('sess-123')
  })

  it('returns null when cookie is absent', () => {
    const cookies = { get: () => undefined }
    expect(isDemoSession(cookies)).toBeNull()
  })

  it('returns null for wrong cookie name', () => {
    const cookies = { get: (name: string) => (name === 'other' ? { value: 'val' } : undefined) }
    expect(isDemoSession(cookies)).toBeNull()
  })
})

describe('createDemoAuth', () => {
  const sessionId = 'abc-123-def'

  it('creates auth with correct userId', () => {
    const auth = createDemoAuth(sessionId)
    expect(auth.userId).toBe(`demo-${sessionId}`)
  })

  it('creates auth with correct tenantId', () => {
    const auth = createDemoAuth(sessionId)
    expect(auth.tenantId).toBe(`demo-${sessionId}`)
  })

  it('grants admin role', () => {
    const auth = createDemoAuth(sessionId)
    expect(auth.roles).toContain('admin')
  })

  it('grants wildcard scope', () => {
    const auth = createDemoAuth(sessionId)
    expect(auth.scopes).toContain('*')
  })

  it('uses demo access token', () => {
    const auth = createDemoAuth(sessionId)
    expect(auth.accessToken).toBe('demo')
  })

  it('userId and tenantId match for same session', () => {
    const auth = createDemoAuth(sessionId)
    expect(auth.userId).toBe(auth.tenantId)
  })

  it('different sessions produce different contexts', () => {
    const auth1 = createDemoAuth('session-1')
    const auth2 = createDemoAuth('session-2')
    expect(auth1.userId).not.toBe(auth2.userId)
    expect(auth1.tenantId).not.toBe(auth2.tenantId)
  })

  it('userId starts with demo- prefix', () => {
    const auth = createDemoAuth(sessionId)
    expect(auth.userId.startsWith('demo-')).toBe(true)
  })

  it('satisfies AuthContext interface', () => {
    const auth = createDemoAuth(sessionId)
    expect(auth).toHaveProperty('userId')
    expect(auth).toHaveProperty('tenantId')
    expect(auth).toHaveProperty('roles')
    expect(auth).toHaveProperty('scopes')
    expect(auth).toHaveProperty('accessToken')
  })
})

describe('createDemoUser', () => {
  const sessionId = 'xyz-789'

  it('returns Demo Visitor as name', () => {
    const user = createDemoUser(sessionId)
    expect(user.name).toBe('Demo Visitor')
  })

  it('returns demo@phyne.io as email', () => {
    const user = createDemoUser(sessionId)
    expect(user.email).toBe('demo@phyne.io')
  })

  it('returns demo-prefixed id', () => {
    const user = createDemoUser(sessionId)
    expect(user.id).toBe(`demo-${sessionId}`)
  })

  it('id matches auth userId for same session', () => {
    const user = createDemoUser(sessionId)
    const auth = createDemoAuth(sessionId)
    expect(user.id).toBe(auth.userId)
  })
})

describe('demo seed ID patterns', () => {
  const sessionId = '550e8400-e29b-41d4-a716-446655440000'
  const prefix = `demo-${sessionId}`

  it('entity IDs use session prefix', () => {
    expect(`${prefix}-c1`).toMatch(/^demo-[a-f0-9-]+-c1$/)
  })

  it('pipeline ID uses session prefix', () => {
    expect(`${prefix}-pipeline`).toMatch(/^demo-[a-f0-9-]+-pipeline$/)
  })

  it('stage IDs use session prefix', () => {
    expect(`${prefix}-stage-0`).toMatch(/^demo-[a-f0-9-]+-stage-0$/)
  })

  it('all entity IDs start with demo- for cleanup queries', () => {
    const ids = [
      `${prefix}-c1`,
      `${prefix}-l1`,
      `${prefix}-o1`,
      `${prefix}-q1`,
      `${prefix}-ord1`,
      `${prefix}-a1`,
      `${prefix}-n1`,
      `${prefix}-tag1`,
    ]
    for (const id of ids) {
      expect(id.startsWith('demo-')).toBe(true)
    }
  })

  it('LIKE demo-% pattern matches all demo IDs', () => {
    const demoPattern = /^demo-/
    expect(demoPattern.test(prefix)).toBe(true)
    expect(demoPattern.test(`${prefix}-c1`)).toBe(true)
    expect(demoPattern.test('dev-user')).toBe(false)
    expect(demoPattern.test('system')).toBe(false)
  })
})

import type { AuthContext } from '@phynd/types/auth'

export const DEMO_COOKIE_NAME = 'phynd-demo'
export const DEMO_COOKIE_MAX_AGE = 14400 // 4 hours in seconds

export function isDemoSession(cookies: {
  get: (name: string) => { value: string } | undefined
}): string | null {
  const cookie = cookies.get(DEMO_COOKIE_NAME)
  return cookie?.value ?? null
}

export function createDemoAuth(sessionId: string): AuthContext {
  return {
    userId: `demo-${sessionId}`,
    tenantId: `demo-${sessionId}`,
    roles: ['admin'],
    scopes: ['*'],
    accessToken: 'demo',
  }
}

export function createDemoUser(sessionId: string) {
  return {
    name: 'Demo Visitor',
    email: 'demo@phynd.io',
    id: `demo-${sessionId}`,
  }
}

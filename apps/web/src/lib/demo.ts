import type { AuthContext } from '@phynd/types/auth'

export const DEMO_COOKIE_NAME = 'phynd-demo'
export const DEMO_COOKIE_MAX_AGE = 14400 // 4 hours in seconds

/**
 * The public demo is opt-in per deployment: it runs only where
 * PHYND_DEMO_ENABLED is exactly "true". Everywhere else /demo starts no
 * session and a phynd-demo cookie is ignored — every reader below returns
 * null, so pages and the API treat the request as signed out.
 */
export function isDemoEnabled(): boolean {
  return process.env.PHYND_DEMO_ENABLED === 'true'
}

// /demo issues crypto.randomUUID(); any other value is not a demo session.
const DEMO_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function demoSessionId(value: string | null | undefined): string | null {
  if (!value || !isDemoEnabled()) return null
  return DEMO_SESSION_ID.test(value) ? value : null
}

export function isDemoSession(cookies: {
  get: (name: string) => { value: string } | undefined
}): string | null {
  return demoSessionId(cookies.get(DEMO_COOKIE_NAME)?.value)
}

/** Parse demo session id from a raw Cookie header (API routes / GraphQL). */
export function getDemoSessionIdFromCookieHeader(cookieHeader: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${DEMO_COOKIE_NAME}=([^;]*)`))
  return demoSessionId(match?.[1])
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

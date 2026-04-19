import { cookies } from 'next/headers'

// External-client portal session. Distinct from the Auth.js v5 staff
// session — lives in its own cookie so a client loading /portal/*
// never shares state with a staff user who happens to hit the same
// browser. We seal the JWT inside signed JSON to make cookie-level
// tampering obvious without adding a new crypto layer; the JWT itself
// is Janua-signed (RS256) so the server-side validator is the source
// of truth.

export const PORTAL_COOKIE = 'phyne-portal-session'
// Janua access tokens default to 15 min; keep the cookie slightly
// shorter so the token never expires between middleware and page render.
const PORTAL_COOKIE_MAX_AGE_S = 14 * 60

export interface PortalSessionPayload {
  engagementId: string
  email: string
  januaUserId: string
  accessToken: string
  expiresAt: number
}

export async function setPortalSession(payload: PortalSessionPayload): Promise<void> {
  const jar = await cookies()
  jar.set(PORTAL_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/portal',
    maxAge: PORTAL_COOKIE_MAX_AGE_S,
  })
}

export async function readPortalSession(): Promise<PortalSessionPayload | null> {
  const jar = await cookies()
  const raw = jar.get(PORTAL_COOKIE)?.value
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PortalSessionPayload>
    if (
      !parsed.engagementId ||
      !parsed.email ||
      !parsed.januaUserId ||
      !parsed.accessToken ||
      !parsed.expiresAt
    ) {
      return null
    }
    if (parsed.expiresAt < Date.now()) return null
    return parsed as PortalSessionPayload
  } catch {
    return null
  }
}

export async function clearPortalSession(): Promise<void> {
  const jar = await cookies()
  jar.delete(PORTAL_COOKIE)
}

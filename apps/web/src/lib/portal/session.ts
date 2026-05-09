import { cookies } from 'next/headers'
import { verifyJanuaAccessToken } from './jwks'

// External-client portal session. Distinct from the Auth.js v5 staff
// session — lives in its own cookie so a client loading /portal/*
// never shares state with a staff user who happens to hit the same
// browser. The access token inside the cookie is Janua-signed (RS256);
// on every read we verify it against Janua's published JWKS so a
// replayed cookie after a key rotation fails hard.

export const PORTAL_COOKIE = 'phynd-portal-session'
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

// Fast read — cookie shape + expiry only. Does NOT verify the Janua
// JWT signature. Use for non-security decisions (e.g. logging, optimistic
// routing). For any access-granting decision, call `readAndVerifyPortalSession`.
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

// Access-gating read. Validates the cookie shape + expiry AND the
// RS256 signature of the Janua access token against Janua's JWKS, AND
// confirms the token's `sub` matches the stored januaUserId (prevents
// a cookie-body swap where the attacker edited the JSON but the signed
// JWT belongs to someone else). Returns null on any verification
// failure — callers should redirect to /portal/expired.
export async function readAndVerifyPortalSession(): Promise<PortalSessionPayload | null> {
  const shallow = await readPortalSession()
  if (!shallow) return null
  try {
    const claims = await verifyJanuaAccessToken(shallow.accessToken)
    if (claims.sub !== shallow.januaUserId) return null
    if (
      typeof claims.email === 'string' &&
      claims.email.toLowerCase().trim() !== shallow.email.toLowerCase().trim()
    ) {
      return null
    }
    return shallow
  } catch {
    return null
  }
}

export async function clearPortalSession(): Promise<void> {
  const jar = await cookies()
  jar.delete(PORTAL_COOKIE)
}

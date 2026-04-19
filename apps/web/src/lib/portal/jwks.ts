import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

// JWKS-backed RS256 verification for the Janua access token that lives
// in the portal session cookie. Until this module was added, the
// portal trusted the freshly-minted Janua token at /portal/verify —
// that's correct the first time, but if the cookie were replayed after
// Janua rotated its signing key the portal would still accept it.
// This verifier re-checks the signature on every portal page render
// against Janua's published JWKS.

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getJwksUrl(): URL {
  const base = process.env.JANUA_API_URL ?? process.env.AUTH_JANUA_ISSUER
  if (!base) {
    throw new Error('JANUA_API_URL not configured for JWKS verification')
  }
  return new URL('/.well-known/jwks.json', base.replace(/\/$/, ''))
}

function getJwks() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(getJwksUrl(), {
      // Pull fresh keys every 15 min. Janua's RS256 keypair has a
      // multi-day TTL, so this is conservative but cheap — the remote
      // set caches in-process between fetches.
      cacheMaxAge: 15 * 60 * 1000,
      cooldownDuration: 30 * 1000,
    })
  }
  return _jwks
}

export interface VerifiedJanuaClaims extends JWTPayload {
  sub: string
  email?: string
  email_verified?: boolean
  roles?: string[]
  scopes?: string[]
}

// Verifies the RS256 signature + the standard claims (exp, iat). Does
// NOT enforce audience/issuer explicitly here — Janua sets `iss` to the
// issuer URL, which we compare to JANUA_API_URL. Returns the verified
// claims or throws.
export async function verifyJanuaAccessToken(
  token: string,
): Promise<VerifiedJanuaClaims> {
  const issuer = (process.env.JANUA_API_URL ?? process.env.AUTH_JANUA_ISSUER)?.replace(/\/$/, '')
  const { payload } = await jwtVerify(token, getJwks(), {
    algorithms: ['RS256'],
    ...(issuer ? { issuer } : {}),
  })
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('Janua token missing sub claim')
  }
  return payload as VerifiedJanuaClaims
}

// Test helper: clear the cached JWKS so a test can re-mock the remote.
// Not exported from any barrel — only imported by unit tests.
export function __resetJwksCacheForTesting(): void {
  _jwks = null
}

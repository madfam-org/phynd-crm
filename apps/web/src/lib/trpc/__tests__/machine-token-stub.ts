/**
 * Janua `client_credentials` token stub: an RS256 key pair, a JWKS served
 * through a `fetch` spy (what jose's remote key set calls), and a minter whose
 * defaults match the claims Janua puts on a service token
 * (`oauth_provider._get_client_credentials_claims`). Synthetic values only.
 */
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { vi } from 'vitest'

import { __resetJwksCacheForTesting } from '@/lib/portal/jwks'

export const ISSUER = 'https://auth.janua.test'
export const AUDIENCE = 'phynd-crm'
export const ORG_ID = '00000000-0000-4000-8000-00000000a001'
export const OTHER_ORG_ID = '00000000-0000-4000-8000-00000000b002'
export const TENANT_ID = 'madfam'
export const CLIENT_ID = 'jnc_test_portal_reader'
export const PORTAL_SCOPE = 'phynd-crm-engagements:read'

type SigningKey = Parameters<SignJWT['sign']>[0]

export interface MintOptions {
  /** Claim overrides; a value of `undefined` removes the claim. */
  claims?: Record<string, unknown>
  iss?: string
  aud?: string | string[]
  sub?: string | null
  iat?: number
  exp?: number
  key?: SigningKey
}

/** The env that turns machine tokens on for these tests. */
export const MACHINE_ENV = {
  AUTH_JANUA_ISSUER: ISSUER,
  PHYND_CRM_MACHINE_TENANT_ID: TENANT_ID,
  PHYND_CRM_MACHINE_JANUA_ORG_ID: ORG_ID,
} as const

export async function createMachineTokenStub() {
  const keys = await generateKeyPair('RS256', { extractable: true })
  const publicJwk = { ...(await exportJWK(keys.publicKey)), kid: 'machine-test', alg: 'RS256' }
  const jwksUrls: string[] = []

  /** Serves the JWKS at `<ISSUER>/.well-known/jwks.json`; anything else is a 404. */
  function installJwks() {
    __resetJwksCacheForTesting()
    jwksUrls.length = 0
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : input.toString()
      jwksUrls.push(url)
      if (url !== `${ISSUER}/.well-known/jwks.json`) return new Response('{}', { status: 404 })
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { 'content-type': 'application/json' },
      })
    })
  }

  async function mint(options: MintOptions = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    const claims: Record<string, unknown> = {
      client_id: CLIENT_ID,
      scope: PORTAL_SCOPE,
      token_use: 'client_credentials',
      actor_type: 'service_account',
      type: 'access',
      roles: ['service_account'],
      org_id: ORG_ID,
      tenant_id: ORG_ID,
    }
    for (const [name, value] of Object.entries(options.claims ?? {})) {
      if (value === undefined) delete claims[name]
      else claims[name] = value
    }
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'machine-test' })
      .setIssuer(options.iss ?? ISSUER)
      .setAudience(options.aud ?? AUDIENCE)
      .setIssuedAt(options.iat ?? now)
      .setExpirationTime(options.exp ?? now + 900)
    if (options.sub !== null) jwt.setSubject(options.sub ?? `service-account:${CLIENT_ID}`)
    return jwt.sign(options.key ?? keys.privateKey)
  }

  return { installJwks, mint, jwksUrls }
}

/**
 * Full Auth.js sign-in flow against an in-process Janua OIDC stub.
 *
 * Drives the real next-auth handlers (CSRF → sign-in redirect → callback with
 * state + PKCE → id_token validation → encrypted JWT session cookie → session
 * read) with `authConfig`. Only the network is stubbed, through the provider's
 * `customFetch`. This is the path where Auth.js replaces the provider id with a
 * random UUID, so a unit test of the callbacks alone would not catch a
 * regression.
 */
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import NextAuth, { customFetch, type NextAuthConfig } from 'next-auth'
import { encode } from 'next-auth/jwt'
import { NextRequest } from 'next/server'
import { beforeAll, describe, expect, it } from 'vitest'

import { authConfig } from '../config'

const ISSUER = 'https://janua.test'
const ORIGIN = 'https://crm.test'
const CLIENT_ID = 'phynd-crm-test'
const SECRET = 'janua-sign-in-test-secret-0123456789'
const SESSION_COOKIE = '__Secure-authjs.session-token'

interface StubUser {
  sub: string
  email: string
  roles?: string[]
  scope?: string
}

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/jwks`,
  response_types_supported: ['code'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
  code_challenge_methods_supported: ['S256'],
}

/** Token endpoint response for an approved user, shaped like Janua's. */
async function tokenResponse(keys: KeyPair, user: StubUser, nonce: string | null) {
  const now = Math.floor(Date.now() / 1000)
  const idToken = await new SignJWT({
    email: user.email,
    name: 'Test User',
    ...(nonce ? { nonce } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setSubject(user.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(keys.privateKey)
  // Janua puts roles/scope on the ACCESS token (see claimsFromAccessToken).
  const claims = { sub: user.sub, roles: user.roles ?? [], scope: user.scope ?? '' }
  const accessToken = `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
  return { access_token: accessToken, token_type: 'Bearer', expires_in: 900, id_token: idToken }
}

/** Minimal Janua OIDC provider: discovery, JWKS, token endpoint. */
function createJanuaStub(keys: KeyPair, publicJwk: Record<string, unknown>) {
  const pendingCodes = new Map<string, { user: StubUser; nonce: string | null }>()
  let nextUser: StubUser | null = null

  async function exchangeCode(init?: RequestInit) {
    const body = new URLSearchParams((init?.body as URLSearchParams | string) ?? '')
    const code = body.get('code') ?? ''
    const pending = pendingCodes.get(code)
    if (!pending || !body.get('code_verifier')) return json({ error: 'invalid_grant' }, 400)
    pendingCodes.delete(code)
    return json(await tokenResponse(keys, pending.user, pending.nonce))
  }

  async function handle(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.origin !== ISSUER) return json({ error: 'unexpected_host', url: url.href }, 599)
    if (url.pathname === '/.well-known/openid-configuration') return json(DISCOVERY)
    if (url.pathname === '/jwks') return json({ keys: [publicJwk] })
    if (url.pathname === '/token') return exchangeCode(init)
    return json({ error: 'not_found', path: url.pathname }, 404)
  }

  return {
    fetch: handle,
    /** The Janua user that approves the next authorization request. */
    actAs(user: StubUser) {
      nextUser = user
    },
    /** Simulates the user approving at Janua's /authorize: returns the redirect back. */
    authorize(authorizationUrl: string): string {
      const url = new URL(authorizationUrl)
      if (!nextUser) throw new Error('stub: no user to authorize')
      const code = `code-${pendingCodes.size}-${Date.now()}-${Math.random()}`
      pendingCodes.set(code, { user: nextUser, nonce: url.searchParams.get('nonce') })
      const back = new URL(url.searchParams.get('redirect_uri') ?? '')
      back.searchParams.set('code', code)
      const state = url.searchParams.get('state')
      if (state) back.searchParams.set('state', state)
      return back.toString()
    },
  }
}

/** Tiny cookie jar: keeps name=value, honours deletions. */
class CookieJar {
  private readonly cookies = new Map<string, string>()

  store(response: Response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(';')
      const eq = pair?.indexOf('=') ?? -1
      if (!pair || eq < 0) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      const expired = attrs.some((a) => {
        const [k, v] = a.trim().split('=')
        if (k?.toLowerCase() === 'max-age') return Number(v) <= 0
        if (k?.toLowerCase() === 'expires') return new Date(v ?? '').getTime() <= Date.now()
        return false
      })
      if (expired || value === '') this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  get(name: string) {
    return this.cookies.get(name)
  }

  set(name: string, value: string) {
    this.cookies.set(name, value)
  }
}

let stub: ReturnType<typeof createJanuaStub>
let handlers: ReturnType<typeof NextAuth>['handlers']

beforeAll(async () => {
  const keys = await generateKeyPair('RS256')
  const publicJwk = { ...(await exportJWK(keys.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }
  stub = createJanuaStub(keys, publicJwk)

  type Provider = NonNullable<NextAuthConfig['providers']>[number]
  const janua = authConfig.providers?.[0] as Extract<Provider, { id?: string }>
  const stubbedJanua = {
    ...janua,
    issuer: ISSUER,
    clientId: CLIENT_ID,
    clientSecret: 'test-client-secret',
    [customFetch]: stub.fetch,
  } as Provider
  ;({ handlers } = NextAuth({ ...authConfig, secret: SECRET, providers: [stubbedJanua] }))
})

function request(path: string, jar: CookieJar, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  const cookie = jar.header()
  if (cookie) headers.set('cookie', cookie)
  return new NextRequest(`${ORIGIN}${path}`, {
    ...init,
    headers,
  } as ConstructorParameters<typeof NextRequest>[1])
}

async function readSession(jar: CookieJar) {
  const res = await handlers.GET(request('/api/auth/session', jar))
  jar.store(res)
  return (await res.json()) as {
    user?: { id: string; email?: string; roles: string[]; scopes: string[] }
  } | null
}

/** Runs one complete browser sign-in and returns the jar holding the session. */
async function signIn(user: StubUser) {
  const jar = new CookieJar()

  const csrfRes = await handlers.GET(request('/api/auth/csrf', jar))
  jar.store(csrfRes)
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }

  const signInRes = await handlers.POST(
    request('/api/auth/signin/janua', jar, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, callbackUrl: `${ORIGIN}/overview` }).toString(),
    }),
  )
  jar.store(signInRes)
  const authorizationUrl = signInRes.headers.get('location') ?? ''
  expect(authorizationUrl.startsWith(`${ISSUER}/authorize`)).toBe(true)

  stub.actAs(user)
  const callback = new URL(stub.authorize(authorizationUrl))
  const callbackRes = await handlers.GET(request(`${callback.pathname}${callback.search}`, jar))
  jar.store(callbackRes)
  expect(callbackRes.headers.get('location')).toBe(`${ORIGIN}/overview`)
  expect(jar.get(SESSION_COOKIE)).toBeTruthy()

  return jar
}

describe('Janua sign-in → session user id', () => {
  const alice: StubUser = {
    sub: '5b0f2c1e-7a7d-4c1e-9d55-2f3b8f6a9c01',
    email: 'alice@example.com',
    roles: ['admin', 'sales_rep'],
    scope: 'openid contacts:read leads:read',
  }

  it('gives the same Janua user the same id on every sign-in, equal to the Janua sub', async () => {
    const first = await readSession(await signIn(alice))
    const second = await readSession(await signIn(alice))

    expect(first?.user?.id).toBe(alice.sub)
    expect(second?.user?.id).toBe(alice.sub)
  })

  it('keeps the id stable across later session reads', async () => {
    const jar = await signIn(alice)
    const reads = [await readSession(jar), await readSession(jar), await readSession(jar)]
    expect(reads.map((s) => s?.user?.id)).toEqual([alice.sub, alice.sub, alice.sub])
  })

  it('gives different Janua users different ids', async () => {
    const bob: StubUser = { sub: '0d6f9e2a-1111-4b2c-8c3d-000000000002', email: 'bob@example.com' }
    const [a, b] = [await readSession(await signIn(alice)), await readSession(await signIn(bob))]
    expect(a?.user?.id).toBe(alice.sub)
    expect(b?.user?.id).toBe(bob.sub)
  })

  it('still carries roles and scopes from the Janua access token', async () => {
    const session = await readSession(await signIn(alice))
    expect(session?.user?.roles).toEqual(['admin', 'sales_rep'])
    expect(session?.user?.scopes).toEqual(['openid', 'contacts:read', 'leads:read'])
    expect(session?.user?.email).toBe(alice.email)
  })

  it('drops a session minted before the fix (random id, no Janua subject)', async () => {
    const jar = new CookieJar()
    const legacy = await encode({
      token: {
        sub: '9a1c7d1e-random-per-login-uuid',
        email: alice.email,
        accessToken: 'opaque',
        roles: ['admin'],
        scopes: [],
      },
      secret: SECRET,
      salt: SESSION_COOKIE,
    })
    jar.set(SESSION_COOKIE, legacy)

    const session = await readSession(jar)
    expect(session).toBeNull()
    expect(jar.get(SESSION_COOKIE)).toBeUndefined()
  })
})

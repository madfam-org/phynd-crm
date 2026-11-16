/**
 * In-process Janua OIDC stub and helpers that drive the real Auth.js sign-in
 * flow (CSRF → sign-in redirect → callback with state + PKCE → id_token
 * validation → encrypted JWT session cookie). Shared by the sign-in tests.
 */
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import NextAuth, { customFetch, type NextAuthConfig } from 'next-auth'
import { NextRequest } from 'next/server'
import { expect } from 'vitest'

import { authConfig } from '../config'

export const ISSUER = 'https://janua.test'
export const ORIGIN = 'https://crm.test'
export const CLIENT_ID = 'phynd-crm-test'
export const SECRET = 'janua-sign-in-test-secret-0123456789'
export const SESSION_COOKIE = '__Secure-authjs.session-token'

export interface StubUser {
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
export class CookieJar {
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

/**
 * Real next-auth handlers built from `authConfig`, with the Janua provider's
 * network replaced by the in-process stub. Call once per test file (beforeAll).
 */
export async function createJanuaSignInHarness() {
  const keys = await generateKeyPair('RS256')
  const publicJwk = { ...(await exportJWK(keys.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }
  const stub = createJanuaStub(keys, publicJwk)

  type Provider = NonNullable<NextAuthConfig['providers']>[number]
  const janua = authConfig.providers?.[0] as Extract<Provider, { id?: string }>
  const stubbedJanua = {
    ...janua,
    issuer: ISSUER,
    clientId: CLIENT_ID,
    clientSecret: 'test-client-secret',
    [customFetch]: stub.fetch,
  } as Provider
  const { handlers } = NextAuth({ ...authConfig, secret: SECRET, providers: [stubbedJanua] })
  return { stub, handlers, signIn: (user: StubUser) => signIn(stub, handlers, user) }
}

type Handlers = ReturnType<typeof NextAuth>['handlers']
type JanuaStub = ReturnType<typeof createJanuaStub>

function request(path: string, jar: CookieJar, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  const cookie = jar.header()
  if (cookie) headers.set('cookie', cookie)
  return new NextRequest(`${ORIGIN}${path}`, {
    ...init,
    headers,
  } as ConstructorParameters<typeof NextRequest>[1])
}

/** Reads `/api/auth/session` like the browser does. */
export async function readSession(handlers: Handlers, jar: CookieJar) {
  const res = await handlers.GET(request('/api/auth/session', jar))
  jar.store(res)
  return (await res.json()) as {
    user?: { id: string; email?: string; roles: string[]; scopes: string[] }
  } | null
}

/** Runs one complete browser sign-in and returns the jar holding the session. */
async function signIn(stub: JanuaStub, handlers: Handlers, user: StubUser) {
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

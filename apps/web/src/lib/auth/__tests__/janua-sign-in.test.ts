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
import { encode } from 'next-auth/jwt'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  CookieJar,
  SECRET,
  SESSION_COOKIE,
  type StubUser,
  createJanuaSignInHarness,
  readSession as readSessionWith,
} from './janua-stub'

let harness: Awaited<ReturnType<typeof createJanuaSignInHarness>>

beforeAll(async () => {
  harness = await createJanuaSignInHarness()
})

const signIn = (user: StubUser) => harness.signIn(user)
const readSession = (jar: CookieJar) => readSessionWith(harness.handlers, jar)

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

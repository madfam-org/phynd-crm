import { describe, expect, it } from 'vitest'

import { authConfig, januaSubjectFromSignIn } from '../config'

describe('authConfig', () => {
  it('trusts the external host supplied by Enclii and Cloudflare', () => {
    expect(authConfig.trustHost).toBe(true)
  })

  it('requests only Janua-supported OIDC scopes', () => {
    const provider = authConfig.providers?.[0] as {
      authorization?: { params?: { scope?: string } }
    }

    const scope = provider.authorization?.params?.scope

    expect(scope).toBe('openid profile email')
    expect(scope?.split(/\s+/)).not.toContain('roles')
  })

  it('decodes roles and scopes from the Janua access token when absent from profile', async () => {
    // Janua carries roles (array) + scope (space-delimited) in the ACCESS token,
    // not the id_token/userinfo that Auth.js surfaces via `profile`.
    const claims = { roles: ['admin', 'sales'], scope: 'openid contacts:read opps:read' }
    const accessToken = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`

    const result = (await authConfig.callbacks?.jwt?.({
      token: {},
      account: { access_token: accessToken, provider: 'janua' },
      profile: { sub: 'user-1' },
      // biome-ignore lint/suspicious/noExplicitAny: test builds a partial NextAuth JWT callback arg
    } as any)) as { roles?: string[]; scopes?: string[] }

    expect(result.roles).toEqual(['admin', 'sales'])
    expect(result.scopes).toEqual(['openid', 'contacts:read', 'opps:read'])
  })

  it('falls back to empty roles/scopes for an opaque or malformed access token', async () => {
    const result = (await authConfig.callbacks?.jwt?.({
      token: {},
      account: { access_token: 'not-a-jwt', provider: 'janua' },
      profile: { sub: 'user-2' },
      // biome-ignore lint/suspicious/noExplicitAny: test builds a partial NextAuth JWT callback arg
    } as any)) as { roles?: string[]; scopes?: string[] }

    expect(result.roles).toEqual([])
    expect(result.scopes).toEqual([])
  })
  it('sets token.sub to the Janua subject on sign-in, not the random Auth.js id', async () => {
    const result = (await authConfig.callbacks?.jwt?.({
      // Auth.js seeds token.sub with crypto.randomUUID() when there is no adapter.
      token: { sub: 'random-per-login-uuid' },
      account: { access_token: 'not-a-jwt', provider: 'janua', providerAccountId: 'janua-sub-1' },
      profile: { sub: 'janua-sub-1' },
      // biome-ignore lint/suspicious/noExplicitAny: test builds a partial NextAuth JWT callback arg
    } as any)) as { sub?: string; januaSub?: string }

    expect(result.sub).toBe('janua-sub-1')
    expect(result.januaSub).toBe('janua-sub-1')
  })

  it('leaves the token unchanged on later calls without an account', async () => {
    const token = { sub: 'janua-sub-1', januaSub: 'janua-sub-1', roles: ['admin'], scopes: ['x'] }
    // biome-ignore lint/suspicious/noExplicitAny: test builds a partial NextAuth JWT callback arg
    const result = await authConfig.callbacks?.jwt?.({ token: { ...token } } as any)

    expect(result).toEqual(token)
  })

  it('drops a pre-fix session token that carries no Janua subject', async () => {
    const result = await authConfig.callbacks?.jwt?.({
      token: { sub: 'random-per-login-uuid', roles: ['admin'] },
      // biome-ignore lint/suspicious/noExplicitAny: test builds a partial NextAuth JWT callback arg
    } as any)

    expect(result).toBeNull()
  })

  it('exposes the Janua subject as session.user.id', async () => {
    const result = (await authConfig.callbacks?.session?.({
      session: { user: { email: 'a@example.com' }, expires: '2099-01-01T00:00:00.000Z' },
      token: { sub: 'janua-sub-1', januaSub: 'janua-sub-1', roles: ['admin'], scopes: ['s'] },
      // biome-ignore lint/suspicious/noExplicitAny: test builds a partial NextAuth session callback arg
    } as any)) as { user: { id: string; roles: string[]; scopes: string[] } }

    expect(result.user.id).toBe('janua-sub-1')
    expect(result.user.roles).toEqual(['admin'])
    expect(result.user.scopes).toEqual(['s'])
  })

  describe('januaSubjectFromSignIn', () => {
    it('returns the OIDC sub when it matches the account id', () => {
      expect(januaSubjectFromSignIn({ providerAccountId: 'abc' }, { sub: 'abc' })).toBe('abc')
    })

    it('refuses a sign-in without a sub claim', () => {
      expect(() => januaSubjectFromSignIn({ providerAccountId: 'abc' }, {})).toThrow(/no `sub`/)
      expect(() => januaSubjectFromSignIn({ providerAccountId: 'abc' }, undefined)).toThrow()
    })

    it('refuses a sign-in whose sub disagrees with the account id', () => {
      expect(() => januaSubjectFromSignIn({ providerAccountId: 'abc' }, { sub: 'xyz' })).toThrow(
        /does not match/,
      )
    })
  })
})

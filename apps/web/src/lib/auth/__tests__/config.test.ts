import { describe, expect, it } from 'vitest'

import { authConfig } from '../config'

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
})

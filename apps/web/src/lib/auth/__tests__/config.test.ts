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
})

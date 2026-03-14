import type { JanuaIdentity } from '@phyne/types/federation'
import type { FederationProvider } from '../../core/types'

interface JanuaRawProfile {
  sub: string
  email: string
  name: string
  picture?: string
  roles: string[]
  scopes: string[]
  email_verified: boolean
  last_login?: string
}

export class JanuaProvider implements FederationProvider<JanuaRawProfile, JanuaIdentity> {
  readonly name = 'janua' as const
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async fetch(externalId: string, token: string, signal?: AbortSignal): Promise<JanuaRawProfile> {
    const response = await fetch(`${this.baseUrl}/api/v1/users/${externalId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: signal ?? AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw Object.assign(new Error(`Janua API error: ${response.statusText}`), {
        status: response.status,
      })
    }

    return response.json() as Promise<JanuaRawProfile>
  }

  map(raw: JanuaRawProfile): JanuaIdentity {
    return {
      userId: raw.sub,
      email: raw.email,
      displayName: raw.name,
      avatarUrl: raw.picture ?? null,
      roles: raw.roles,
      scopes: raw.scopes,
      verified: raw.email_verified,
      lastLoginAt: raw.last_login ? new Date(raw.last_login) : null,
    }
  }

  getCacheKey(externalId: string, _tenantId: string): string {
    return externalId
  }
}

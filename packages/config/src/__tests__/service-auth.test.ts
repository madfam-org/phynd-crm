import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FEDERATION_SERVICE_USER_ID,
  resolveFederationServiceUserId,
} from '../service-auth'

describe('resolveFederationServiceUserId', () => {
  it('defaults to service:selva', () => {
    vi.stubEnv('FEDERATION_SERVICE_USER_ID', '')
    expect(resolveFederationServiceUserId()).toBe(DEFAULT_FEDERATION_SERVICE_USER_ID)
    expect(DEFAULT_FEDERATION_SERVICE_USER_ID).toBe('service:selva')
  })

  it('honors FEDERATION_SERVICE_USER_ID override', () => {
    vi.stubEnv('FEDERATION_SERVICE_USER_ID', 'service:selva-staging')
    expect(resolveFederationServiceUserId()).toBe('service:selva-staging')
  })
})

import { resolveTenantIdFromHost } from '@/lib/http/tenant-context'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

import { SERVICE_AUTH_SCOPES, createServiceAuth } from '../request-context'

describe('createServiceAuth', () => {
  it('uses service:selva principal with v1 scopes for madfam tenant', () => {
    const auth = createServiceAuth('madfam')
    expect(auth.userId).toBe('service:selva')
    expect(auth.tenantId).toBe('madfam')
    expect(auth.roles).toEqual(['service'])
    expect(auth.scopes).toEqual([...SERVICE_AUTH_SCOPES])
  })

  it('pairs with host-derived tenant for crm.madfam.io', () => {
    expect(resolveTenantIdFromHost('crm.madfam.io')).toBe('madfam')
    expect(createServiceAuth(resolveTenantIdFromHost('crm.madfam.io')).tenantId).toBe('madfam')
  })
})

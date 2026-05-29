import { describe, expect, it } from 'vitest'

import { resolveTenantIdFromHeaders, resolveTenantIdFromHost } from '../tenant-context'

describe('resolveTenantIdFromHost', () => {
  it('maps crm.madfam.io to madfam', () => {
    expect(resolveTenantIdFromHost('crm.madfam.io')).toBe('madfam')
  })

  it('maps crm.phynd.app to phynd', () => {
    expect(resolveTenantIdFromHost('crm.phynd.app')).toBe('phynd')
  })

  it('maps marketing phynd.app to phynd brand tenant', () => {
    expect(resolveTenantIdFromHost('phynd.app')).toBe('phynd')
  })

  it('falls back to madfam for localhost', () => {
    expect(resolveTenantIdFromHost('localhost:3000')).toBe('madfam')
  })
})

describe('resolveTenantIdFromHeaders', () => {
  it('prefers x-forwarded-host', () => {
    const headers = new Headers({
      'x-forwarded-host': 'crm.madfam.io',
      host: 'crm.phynd.app',
    })
    expect(resolveTenantIdFromHeaders(headers)).toBe('madfam')
  })
})

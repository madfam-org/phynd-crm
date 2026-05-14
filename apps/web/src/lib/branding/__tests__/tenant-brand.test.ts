import { describe, expect, it } from 'vitest'

import { getBrandForHost, normalizeHost } from '../tenant-brand'

describe('tenant brand resolution', () => {
  it('normalizes forwarded host values', () => {
    expect(normalizeHost('CRM.MADFAM.IO:443')).toBe('crm.madfam.io')
    expect(normalizeHost('crm.madfam.io, phynd.app')).toBe('crm.madfam.io')
  })

  it('resolves crm.madfam.io to the MADFAM-labelled PhyndCRM slice', () => {
    const brand = getBrandForHost('crm.madfam.io')

    expect(brand.tenantId).toBe('madfam')
    expect(brand.productName).toBe('MADFAM CRM')
    expect(brand.poweredBy).toBe('Powered by PhyndCRM')
    expect(brand.description).toContain('MADFAM-labelled PhyndCRM portal')
  })

  it('keeps phynd.app on the generic Phynd brand', () => {
    const brand = getBrandForHost('phynd.app')

    expect(brand.tenantId).toBe('phynd')
    expect(brand.productName).toBe('Phynd')
    expect(brand.poweredBy).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { getDormantClientHostRedirect } from '../app-host'

describe('getDormantClientHostRedirect (holding redirect until first client tenant)', () => {
  it('301-targets browser paths on crm.phynd.app to crm.madfam.io, preserving path+query', () => {
    expect(getDormantClientHostRedirect('crm.phynd.app', '/', '')).toBe('https://crm.madfam.io/')
    expect(getDormantClientHostRedirect('crm.phynd.app', '/leads/ebf478d8', '?tab=notes')).toBe(
      'https://crm.madfam.io/leads/ebf478d8?tab=notes',
    )
    expect(getDormantClientHostRedirect('crm.phynd.app', '/login', '?next=%2Fleads%2Fx')).toBe(
      'https://crm.madfam.io/login?next=%2Fleads%2Fx',
    )
  })

  it('never redirects /api — webhook producers and OAuth machinery do not follow redirects', () => {
    expect(
      getDormantClientHostRedirect('crm.phynd.app', '/api/auth/callback/janua', '?code=x'),
    ).toBeNull()
    expect(getDormantClientHostRedirect('crm.phynd.app', '/api/webhooks/nauta', '')).toBeNull()
    expect(getDormantClientHostRedirect('crm.phynd.app', '/api/trpc/leads.getById', '')).toBeNull()
  })

  it('leaves every other host alone — the MADFAM CRM and marketing site are unaffected', () => {
    expect(getDormantClientHostRedirect('crm.madfam.io', '/', '')).toBeNull()
    expect(getDormantClientHostRedirect('staging-crm.madfam.io', '/leads', '')).toBeNull()
    expect(getDormantClientHostRedirect('phynd.app', '/', '')).toBeNull()
    expect(getDormantClientHostRedirect('www.phynd.app', '/pricing', '')).toBeNull()
    expect(getDormantClientHostRedirect(null, '/', '')).toBeNull()
    expect(getDormantClientHostRedirect(undefined, '/', '')).toBeNull()
  })

  it('normalizes the host header (port suffix still matches)', () => {
    expect(getDormantClientHostRedirect('crm.phynd.app:443', '/overview', '')).toBe(
      'https://crm.madfam.io/overview',
    )
  })
})

import { describe, expect, it } from 'vitest'

import { getAuthenticatedAppRootRedirect, isAuthenticatedAppHost } from '../app-host'

describe('authenticated app host routing', () => {
  it('treats crm.madfam.io as the MADFAM authenticated tenant slice', () => {
    expect(isAuthenticatedAppHost('crm.madfam.io')).toBe(true)
    expect(getAuthenticatedAppRootRedirect('crm.madfam.io', '/', false)).toBe('/login')
    expect(getAuthenticatedAppRootRedirect('crm.madfam.io', '/', true)).toBe('/overview')
  })

  it('treats crm.phyne.app as the generic authenticated app host', () => {
    expect(isAuthenticatedAppHost('crm.phyne.app')).toBe(true)
    expect(getAuthenticatedAppRootRedirect('crm.phyne.app', '/', false)).toBe('/login')
  })

  it('leaves phynd.app as the public marketing host', () => {
    expect(isAuthenticatedAppHost('phynd.app')).toBe(false)
    expect(getAuthenticatedAppRootRedirect('phynd.app', '/', false)).toBeNull()
  })

  it('does not treat app.phynd.app as a generic app host', () => {
    expect(isAuthenticatedAppHost('app.phynd.app')).toBe(false)
    expect(getAuthenticatedAppRootRedirect('app.phynd.app', '/', false)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import { getAuthenticatedAppRootRedirect, isAuthenticatedAppHost } from '../app-host'

describe('authenticated app host routing', () => {
  it('treats crm.madfam.io as the MADFAM authenticated tenant slice', () => {
    expect(isAuthenticatedAppHost('crm.madfam.io')).toBe(true)
    expect(getAuthenticatedAppRootRedirect('crm.madfam.io', '/', false)).toBe('/login')
    expect(getAuthenticatedAppRootRedirect('crm.madfam.io', '/', true)).toBe('/overview')
  })

  it('treats app.phyne.app as the generic authenticated app host', () => {
    expect(isAuthenticatedAppHost('app.phyne.app')).toBe(true)
    expect(getAuthenticatedAppRootRedirect('app.phyne.app', '/', false)).toBe('/login')
  })

  it('leaves phynd.app as the public marketing host', () => {
    expect(isAuthenticatedAppHost('phynd.app')).toBe(false)
    expect(getAuthenticatedAppRootRedirect('phynd.app', '/', false)).toBeNull()
  })
})

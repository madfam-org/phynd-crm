import { describe, expect, it } from 'vitest'

import {
  CANONICAL_PHYND_APP_HOST,
  getAuthenticatedAppRootRedirect,
  getCanonicalLoginHost,
  isAuthenticatedAppHost,
  resolveAuthOriginFromHost,
} from '../app-host'

describe('authenticated app host routing', () => {
  it('treats crm.madfam.io as the MADFAM authenticated tenant slice', () => {
    expect(isAuthenticatedAppHost('crm.madfam.io')).toBe(true)
    expect(getAuthenticatedAppRootRedirect('crm.madfam.io', '/', false)).toBe('/login')
    expect(getAuthenticatedAppRootRedirect('crm.madfam.io', '/', true)).toBe('/overview')
  })

  it('treats crm.phynd.app as the generic authenticated app host', () => {
    expect(isAuthenticatedAppHost('crm.phynd.app')).toBe(true)
    expect(getAuthenticatedAppRootRedirect('crm.phynd.app', '/', false)).toBe('/login')
  })

  it('leaves phynd.app as the public marketing host', () => {
    expect(isAuthenticatedAppHost('phynd.app')).toBe(false)
    expect(getAuthenticatedAppRootRedirect('phynd.app', '/', false)).toBeNull()
  })

  it('canonicalizes marketing-host login to the generic CRM app host', () => {
    expect(getCanonicalLoginHost('phynd.app', '/login')).toBe(CANONICAL_PHYND_APP_HOST)
    expect(getCanonicalLoginHost('www.phynd.app', '/login')).toBe(CANONICAL_PHYND_APP_HOST)
    expect(getCanonicalLoginHost('crm.phynd.app', '/login')).toBeNull()
    expect(getCanonicalLoginHost('phynd.app', '/')).toBeNull()
  })

  it('does not treat app.phynd.app as a generic app host', () => {
    expect(isAuthenticatedAppHost('app.phynd.app')).toBe(false)
    expect(getAuthenticatedAppRootRedirect('app.phynd.app', '/', false)).toBeNull()
  })

  it('resolves Auth.js origins per host', () => {
    expect(resolveAuthOriginFromHost('crm.madfam.io')).toBe('https://crm.madfam.io')
    expect(resolveAuthOriginFromHost('crm.phynd.app')).toBe('https://crm.phynd.app')
    expect(resolveAuthOriginFromHost('phynd.app')).toBe(`https://${CANONICAL_PHYND_APP_HOST}`)
    expect(resolveAuthOriginFromHost('www.phynd.app')).toBe(`https://${CANONICAL_PHYND_APP_HOST}`)
  })
})

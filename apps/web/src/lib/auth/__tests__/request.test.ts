import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { normalizeAuthRequest } from '../request'

function authRequest(headers: Record<string, string> = {}) {
  return new NextRequest('https://phynd-crm-web-5d8db657f5-6wc2k:3000/api/auth/providers?foo=bar', {
    headers,
  })
}

describe('normalizeAuthRequest', () => {
  it('rewrites internal pod URLs to the canonical Phynd app host', () => {
    const request = normalizeAuthRequest(
      authRequest({
        'x-forwarded-host': 'phynd.app',
        'x-forwarded-proto': 'https',
        host: 'phynd-crm-web-5d8db657f5-6wc2k:3000',
      }),
    )

    expect(request.url).toBe('https://crm.phynd.app/api/auth/providers?foo=bar')
    expect(request.headers.get('host')).toBe('crm.phynd.app')
    expect(request.headers.get('x-forwarded-host')).toBe('crm.phynd.app')
    expect(request.headers.get('x-forwarded-proto')).toBe('https')
  })

  it('canonicalizes www marketing Auth.js requests to the Phynd app host', () => {
    const request = normalizeAuthRequest(
      authRequest({
        'x-forwarded-host': 'www.phynd.app',
        'x-forwarded-proto': 'https',
      }),
    )

    expect(request.url).toBe('https://crm.phynd.app/api/auth/providers?foo=bar')
    expect(request.headers.get('host')).toBe('crm.phynd.app')
  })

  it('keeps the staging CRM host when the edge forwards it', () => {
    const request = normalizeAuthRequest(
      authRequest({
        'x-forwarded-host': 'staging-crm.madfam.io',
        'x-forwarded-proto': 'https',
      }),
    )

    expect(request.url).toBe('https://staging-crm.madfam.io/api/auth/providers?foo=bar')
    expect(request.headers.get('host')).toBe('staging-crm.madfam.io')
  })

  it('keeps the MADFAM tenant host when the edge forwards it', () => {
    const request = normalizeAuthRequest(
      authRequest({
        'x-forwarded-host': 'crm.madfam.io',
        'x-forwarded-proto': 'https',
      }),
    )

    expect(request.url).toBe('https://crm.madfam.io/api/auth/providers?foo=bar')
    expect(request.headers.get('host')).toBe('crm.madfam.io')
  })

  it('falls back to the canonical Phynd app origin when only an internal host is present', () => {
    const request = normalizeAuthRequest(
      authRequest({
        host: 'phynd-crm-web-5d8db657f5-6wc2k:3000',
      }),
    )

    expect(request.url).toBe('https://crm.phynd.app/api/auth/providers?foo=bar')
    expect(request.headers.get('host')).toBe('crm.phynd.app')
  })

  it('preserves POST method and body while rewriting callback URLs', async () => {
    const request = normalizeAuthRequest(
      new NextRequest('https://phynd-crm-web-5d8db657f5-6wc2k:3000/api/auth/callback/janua', {
        body: 'code=abc&state=xyz',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-forwarded-host': 'phynd.app',
          'x-forwarded-proto': 'https',
        },
        method: 'POST',
      }),
    )

    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://crm.phynd.app/api/auth/callback/janua')
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(await request.text()).toBe('code=abc&state=xyz')
  })
})

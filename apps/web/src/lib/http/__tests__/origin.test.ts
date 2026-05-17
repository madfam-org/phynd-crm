import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { externalOriginForRequest, externalUrl } from '../origin'

function requestWithHeaders(headers: Record<string, string>) {
  return new NextRequest('https://phynd-crm-web-955d6b8cd-ftq9q:3000/demo', { headers })
}

describe('externalOriginForRequest', () => {
  it('uses trusted forwarded hosts instead of internal pod URLs', () => {
    const request = requestWithHeaders({
      'x-forwarded-host': 'phynd.app',
      'x-forwarded-proto': 'https',
      host: 'phynd-crm-web-955d6b8cd-ftq9q:3000',
    })

    expect(externalOriginForRequest(request)).toBe('https://phynd.app')
    expect(externalUrl('/overview', request).toString()).toBe('https://phynd.app/overview')
  })

  it('supports the MADFAM-labelled PhyndCRM slice', () => {
    const request = requestWithHeaders({
      'x-forwarded-host': 'crm.madfam.io',
      'x-forwarded-proto': 'https',
    })

    expect(externalUrl('/overview', request).toString()).toBe('https://crm.madfam.io/overview')
  })

  it('supports the generic authenticated PhyndCRM app host', () => {
    const request = requestWithHeaders({
      'x-forwarded-host': 'crm.phynd.app',
      'x-forwarded-proto': 'https',
    })

    expect(externalUrl('/overview', request).toString()).toBe('https://crm.phynd.app/overview')
  })

  it('rejects the retired app.phynd.app host and falls back to phynd.app', () => {
    const request = requestWithHeaders({
      'x-forwarded-host': 'app.phynd.app',
      'x-forwarded-proto': 'https',
    })

    expect(externalUrl('/overview', request).toString()).toBe('https://phynd.app/overview')
  })

  it('falls back to the public Phynd origin for untrusted hosts', () => {
    const request = requestWithHeaders({
      host: 'phynd-crm-web-955d6b8cd-ftq9q:3000',
    })

    expect(externalUrl('/overview', request).toString()).toBe('https://phynd.app/overview')
  })
})

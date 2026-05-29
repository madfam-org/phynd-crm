import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'vitest'
import {
  applyFrameEmbeddingHeaders,
  isEmbeddableDashboardPath,
  shouldAllowSelvaEmbed,
} from '../frame-embed'

describe('frame-embed', () => {
  const original = process.env.PHYND_SELVA_EMBED_ALLOWED

  afterEach(() => {
    process.env.PHYND_SELVA_EMBED_ALLOWED = original
  })

  it('detects embeddable dashboard paths', () => {
    assert.equal(isEmbeddableDashboardPath('/overview'), true)
    assert.equal(isEmbeddableDashboardPath('/contacts/abc'), true)
    assert.equal(isEmbeddableDashboardPath('/login'), false)
    assert.equal(isEmbeddableDashboardPath('/api/health'), false)
  })

  it('allows Selva embed only when env flag and dashboard path match', () => {
    process.env.PHYND_SELVA_EMBED_ALLOWED = 'true'
    assert.equal(shouldAllowSelvaEmbed('/overview'), true)
    assert.equal(shouldAllowSelvaEmbed('/login'), false)
  })

  it('sets frame-ancestors CSP when Selva embed is allowed', () => {
    process.env.PHYND_SELVA_EMBED_ALLOWED = 'true'
    const headers = new Headers({ 'X-Frame-Options': 'DENY' })
    applyFrameEmbeddingHeaders(headers, '/overview')

    assert.equal(headers.get('Content-Security-Policy')?.includes('frame-ancestors'), true)
    assert.equal(headers.get('X-Frame-Options'), null)
  })

  it('keeps clickjacking protection on public routes', () => {
    process.env.PHYND_SELVA_EMBED_ALLOWED = 'true'
    const headers = new Headers()
    applyFrameEmbeddingHeaders(headers, '/login')

    assert.equal(headers.get('X-Frame-Options'), 'DENY')
    assert.equal(headers.get('Content-Security-Policy'), null)
  })
})

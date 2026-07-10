import { describe, expect, it } from 'vitest'
import { sanitizeForwardedHeaders } from '../forwarded-headers'

describe('sanitizeForwardedHeaders', () => {
  it('leaves clean single-value headers untouched', () => {
    const input = new Headers({
      host: 'crm.madfam.io',
      'x-forwarded-host': 'crm.madfam.io',
      'x-forwarded-proto': 'https',
    })
    const { headers, changed } = sanitizeForwardedHeaders(input)
    expect(changed).toBe(false)
    expect(headers.get('x-forwarded-proto')).toBe('https')
    expect(headers.get('x-forwarded-host')).toBe('crm.madfam.io')
  })

  it('reduces a comma-stacked x-forwarded-proto to its first value (tunnel chain)', () => {
    const input = new Headers({ 'x-forwarded-proto': 'https,https' })
    const { headers, changed } = sanitizeForwardedHeaders(input)
    expect(changed).toBe(true)
    expect(headers.get('x-forwarded-proto')).toBe('https')
  })

  it('reduces a comma-stacked x-forwarded-host and trims whitespace', () => {
    const input = new Headers({ 'x-forwarded-host': 'crm.madfam.io, internal-hop.local' })
    const { headers, changed } = sanitizeForwardedHeaders(input)
    expect(changed).toBe(true)
    expect(headers.get('x-forwarded-host')).toBe('crm.madfam.io')
  })

  it('skips leading empty tokens (",crm.madfam.io")', () => {
    const input = new Headers({ 'x-forwarded-host': ' , crm.madfam.io' })
    const { headers } = sanitizeForwardedHeaders(input)
    expect(headers.get('x-forwarded-host')).toBe('crm.madfam.io')
  })

  it('deletes a header whose value is empty or only separators', () => {
    const input = new Headers({ 'x-forwarded-host': ' , ' })
    const { headers, changed } = sanitizeForwardedHeaders(input)
    expect(changed).toBe(true)
    expect(headers.get('x-forwarded-host')).toBeNull()
  })

  it('leaves x-forwarded-for untouched (comma list is semantically correct there)', () => {
    const input = new Headers({ 'x-forwarded-for': '203.0.113.7, 172.16.0.1' })
    const { headers, changed } = sanitizeForwardedHeaders(input)
    expect(changed).toBe(false)
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.7, 172.16.0.1')
  })

  it('does not add headers that were absent', () => {
    const { headers, changed } = sanitizeForwardedHeaders(new Headers())
    expect(changed).toBe(false)
    expect(headers.get('x-forwarded-proto')).toBeNull()
  })

  it('preserves unrelated headers verbatim', () => {
    const input = new Headers({
      cookie: 'phynd-demo=abc',
      'x-forwarded-proto': 'https,https',
    })
    const { headers } = sanitizeForwardedHeaders(input)
    expect(headers.get('cookie')).toBe('phynd-demo=abc')
  })
})

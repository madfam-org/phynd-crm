import { describe, expect, it } from 'vitest'
import { UNKNOWN_CLIENT_ADDRESS, clientAddress } from '../client-address'

function headers(init: Record<string, string>) {
  return new Headers(init)
}

describe('clientAddress', () => {
  it('prefers cf-connecting-ip over x-forwarded-for', () => {
    expect(
      clientAddress(
        headers({
          'cf-connecting-ip': '203.0.113.7',
          'x-forwarded-for': '198.51.100.1, 198.51.100.2',
        }),
      ),
    ).toBe('203.0.113.7')
  })

  it('uses the last x-forwarded-for entry when cf-connecting-ip is absent', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': '198.51.100.1, 203.0.113.9' }))).toBe(
      '203.0.113.9',
    )
  })

  it('ignores the first x-forwarded-for entry', () => {
    const address = clientAddress(headers({ 'x-forwarded-for': '192.0.2.250,203.0.113.9' }))
    expect(address).not.toBe('192.0.2.250')
    expect(address).toBe('203.0.113.9')
  })

  it('accepts a single x-forwarded-for entry', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': ' 203.0.113.9 ' }))).toBe('203.0.113.9')
  })

  it('accepts IPv6 and lower-cases it', () => {
    expect(clientAddress(headers({ 'cf-connecting-ip': '2001:DB8::A' }))).toBe('2001:db8::a')
    expect(clientAddress(headers({ 'x-forwarded-for': '198.51.100.1, 2001:DB8::B' }))).toBe(
      '2001:db8::b',
    )
  })

  it('falls back to x-forwarded-for when cf-connecting-ip is not an address', () => {
    expect(
      clientAddress(headers({ 'cf-connecting-ip': 'garbage', 'x-forwarded-for': '203.0.113.9' })),
    ).toBe('203.0.113.9')
  })

  it.each([
    ['a limiter-shaped key', 'mcp:abc'],
    ['a prefixed key', 'convergence:203.0.113.9'],
    ['a hostname', 'localhost'],
    ['an empty value', ''],
    ['an address with a port', '203.0.113.9:443'],
  ])('maps %s to the fixed key', (_label, value) => {
    expect(clientAddress(headers({ 'cf-connecting-ip': value, 'x-forwarded-for': value }))).toBe(
      UNKNOWN_CLIENT_ADDRESS,
    )
  })

  it('maps a list whose last entry is not an address to the fixed key', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.9, mcp:abc' }))).toBe(
      UNKNOWN_CLIENT_ADDRESS,
    )
    expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.9,' }))).toBe(
      UNKNOWN_CLIENT_ADDRESS,
    )
  })

  it('returns the fixed key when no headers are present', () => {
    expect(clientAddress(new Headers())).toBe(UNKNOWN_CLIENT_ADDRESS)
    expect(UNKNOWN_CLIENT_ADDRESS).toBe('unknown')
  })
})

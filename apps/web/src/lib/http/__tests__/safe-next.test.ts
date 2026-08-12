import { describe, expect, it } from 'vitest'
import { safeNextPath } from '../safe-next'

describe('safeNextPath', () => {
  it('passes through same-origin absolute paths with query strings', () => {
    expect(safeNextPath('/leads/55317fcd?tab=notes')).toBe('/leads/55317fcd?tab=notes')
  })

  it.each([
    ['https://evil.example/phish', 'absolute URL'],
    ['//evil.example/phish', 'protocol-relative'],
    ['/\\evil.example', 'backslash protocol-relative'],
    ['/leads\\..\\admin', 'embedded backslash'],
    ['javascript:alert(1)', 'scheme'],
    ['leads/x', 'relative path without leading slash'],
    ['', 'empty'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('collapses %s (%s) to the fallback', (raw, _label) => {
    expect(safeNextPath(raw)).toBe('/overview')
  })

  it('refuses auth-flow paths that would loop the sign-in', () => {
    expect(safeNextPath('/login?next=/login')).toBe('/overview')
    expect(safeNextPath('/callback')).toBe('/overview')
    expect(safeNextPath('/api/auth/signin')).toBe('/overview')
  })

  it('honors a caller-supplied fallback', () => {
    expect(safeNextPath('//evil.example', '/somewhere')).toBe('/somewhere')
  })
})

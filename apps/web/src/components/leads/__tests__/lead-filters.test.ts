import { describe, expect, it } from 'vitest'
import { leadsHref, parseLeadsFilters } from '../lead-filters'

describe('parseLeadsFilters', () => {
  it('reads owner=me and tier=A (the owner link)', () => {
    expect(parseLeadsFilters({ owner: 'me', tier: 'A' })).toEqual({ owner: 'me', tier: 'A' })
  })

  it('accepts unassigned, a user id, and a lower-case tier', () => {
    expect(parseLeadsFilters({ owner: 'unassigned', tier: 'b' })).toEqual({
      owner: 'unassigned',
      tier: 'B',
    })
    const id = '0b6d1d7e-2f00-4c3a-9a51-2d8f2b1b0c11'
    expect(parseLeadsFilters({ owner: id })).toEqual({ owner: id })
  })

  it('ignores anything else', () => {
    expect(parseLeadsFilters({ owner: 'someone', tier: 'D' })).toEqual({})
    expect(parseLeadsFilters({ owner: ['me', 'unassigned'] })).toEqual({ owner: 'me' })
    expect(parseLeadsFilters({})).toEqual({})
  })
})

describe('leadsHref', () => {
  it('builds shareable links in a fixed order', () => {
    expect(leadsHref({ tier: 'A', owner: 'me' })).toBe('/leads?owner=me&tier=A')
    expect(leadsHref({ tier: 'C' })).toBe('/leads?tier=C')
    expect(leadsHref({})).toBe('/leads')
  })
})

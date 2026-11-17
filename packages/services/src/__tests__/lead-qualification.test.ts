import { describe, expect, it } from 'vitest'
import {
  emailDomain,
  isFreeMailAddress,
  isTestLead,
  tierForScore,
} from '../leads/lead-qualification'

describe('tierForScore', () => {
  it.each([
    [12, 'A'],
    [7, 'A'],
    [6, 'B'],
    [4, 'B'],
    [3, 'C'],
    [0, 'C'],
    [-2, 'C'],
  ] as const)('score %d is tier %s', (score, tier) => {
    expect(tierForScore(score)).toBe(tier)
  })

  it('keeps a waitlist lead in C whatever its score', () => {
    expect(tierForScore(9, 'waitlist')).toBe('C')
    expect(tierForScore(9, 'sales-request')).toBe('A')
  })

  it('has no tier before a score exists', () => {
    expect(tierForScore(null)).toBeNull()
    expect(tierForScore(undefined, 'waitlist')).toBeNull()
  })
})

describe('free-mail detection', () => {
  it('reads the domain in lower case', () => {
    expect(emailDomain('Persona@Ejemplo.MX')).toBe('ejemplo.mx')
    expect(emailDomain('no-at-sign')).toBeNull()
    expect(emailDomain('')).toBeNull()
  })

  it('matches whole free-mail domains only', () => {
    expect(isFreeMailAddress('someone@gmail.com')).toBe(true)
    expect(isFreeMailAddress('someone@outlook.com')).toBe(true)
    expect(isFreeMailAddress('someone@empresa-ficticia.mx')).toBe(false)
    expect(isFreeMailAddress('someone@notgmail.com')).toBe(false)
    expect(isFreeMailAddress(null)).toBeNull()
  })
})

describe('isTestLead', () => {
  it.each([
    [{ source: 'provisioning_smoke', email: 'ana@empresa-ficticia.mx' }],
    [{ source: 'synthetic-probe' }],
    [{ source: 'marketing-hero', email: 'x@anything.invalid' }],
    [{ source: 'nauta', email: 'smoke@example.test' }],
    [{ source: 'kalya', email: 'someone@example.com' }],
    [{ source: 'marketing-hero', email: 'e2e-run-42@empresa-ficticia.mx' }],
    [{ source: 'marketing-hero', email: 'E2E+1@empresa-ficticia.mx' }],
    [{ source: 'nauta', email: 'persona@empresa-ficticia.mx', name: '[E2E] Prospecto' }],
    [{ source: 'nauta', email: 'persona@empresa-ficticia.mx', message: ' probe ' }],
  ])('flags %o', (input) => {
    expect(isTestLead(input)).toBe(true)
  })

  it.each([
    [{ source: 'marketing-hero', email: 'persona@empresa-ficticia.mx' }],
    [{ source: 'nauta', email: 'persona@empresa-ficticia.mx', message: 'Quiero una demo' }],
    [{ source: 'marketing-hero', email: 'e2efan@empresa-ficticia.mx' }],
    [{ source: 'marketing-hero', email: 'persona@testing.mx' }],
    // The Nauta-only labels do not apply to other feeds.
    [{ source: 'kalya', email: 'persona@empresa-ficticia.mx', message: 'probe' }],
  ])('keeps %o', (input) => {
    expect(isTestLead(input)).toBe(false)
  })
})

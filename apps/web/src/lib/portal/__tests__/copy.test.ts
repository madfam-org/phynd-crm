import { describe, expect, it } from 'vitest'
import {
  formatPortalDate,
  formatPortalMoney,
  itemStatusLabel,
  portalCopy,
  portalRegister,
} from '../copy'

// Collects every string (and function output) of a copy object, by key path.
function strings(value: unknown, path = ''): Record<string, string> {
  if (typeof value === 'string') return { [path]: value }
  if (typeof value === 'function') return { [path]: String(value('Nombre')) }
  if (value && typeof value === 'object') {
    return Object.assign(
      {},
      ...Object.entries(value).map(([k, v]) => strings(v, path ? `${path}.${k}` : k)),
    )
  }
  return {}
}

const tu = strings(portalCopy('tu'))
const usted = strings(portalCopy('usted'))

describe('portal register', () => {
  it('speaks tú only to contacts who chose tú; usted otherwise (incl. not asked yet)', () => {
    expect(portalRegister('tu')).toBe('tu')
    expect(portalRegister('usted')).toBe('usted')
    expect(portalRegister(null)).toBe('usted')
    expect(portalRegister(undefined)).toBe('usted')
    expect(portalRegister('TU')).toBe('usted')
  })

  it('has the same keys in both registers', () => {
    expect(Object.keys(tu).sort()).toEqual(Object.keys(usted).sort())
  })

  it('keeps each register consistent', () => {
    // Possessive "su"/"Su" and usted verb forms never leak into tú, and vice versa.
    // Whole words only, Unicode-aware (JS \b treats accented letters as boundaries).
    const words = (list: string[]) => new RegExp(`(?<!\\p{L})(${list.join('|')})(?!\\p{L})`, 'u')
    const ustedMarkers = words([
      'su',
      'Su',
      'sus',
      'Usted',
      'usted',
      'puede',
      'Puede',
      'verá',
      'Intente',
      'Escriba',
      'Le',
    ])
    const tuMarkers = words([
      'tu',
      'Tu',
      'tus',
      'Tú',
      'puedes',
      'Puedes',
      'verás',
      'ves',
      'Intenta',
      'Escribe',
      'Te',
    ])
    for (const [key, text] of Object.entries(tu)) {
      if (key === 'register') continue
      expect(text, `tú ${key}`).not.toMatch(ustedMarkers)
    }
    for (const [key, text] of Object.entries(usted)) {
      if (key === 'register' || key === 'clientSide') continue
      expect(text, `usted ${key}`).not.toMatch(tuMarkers)
    }
    expect(portalCopy('tu').clientSide).toBe('Tú')
    expect(portalCopy('usted').clientSide).toBe('Usted')
  })

  it('has no English left in the portal copy', () => {
    for (const text of Object.values(usted)) {
      expect(text).not.toMatch(/\b(the|your|please|payment|quote|project)\b/i)
    }
  })

  it('labels the client-awaited status in the reader register', () => {
    expect(itemStatusLabel(portalCopy('tu'), 'awaiting_client')).toBe('Espera tu respuesta')
    expect(itemStatusLabel(portalCopy('usted'), 'awaiting_client')).toBe('Espera su respuesta')
    expect(itemStatusLabel(portalCopy('usted'), 'blocked')).toBe('En espera')
  })

  it('formats dates in Mexico City time and money in es-MX', () => {
    // 05:00 UTC is still the previous day in Mexico City.
    expect(formatPortalDate('2026-11-02T05:00:00Z')).toMatch(/1 nov/)
    expect(formatPortalMoney('11600', 'MXN')).toBe('$11,600.00')
  })
})

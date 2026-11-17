import { describe, expect, it } from 'vitest'
import { fullMessageFromNote, messageFromNote, namedBreakdown } from '../leads/lead-queue.service'
import { phoneKey } from '../leads/lead-workspace.service'

describe('message from a contact note', () => {
  it('drops the Avala label and keeps the first line', () => {
    expect(
      messageFromNote('Message from the Avala form\n\nQueremos certificar.\nSegunda línea'),
    ).toBe('Queremos certificar.')
  })

  it('skips the intake placeholder and origin lines', () => {
    expect(messageFromNote('(sin mensaje)\n\n— vía formulario del sitio')).toBeNull()
    expect(fullMessageFromNote('Hola\nquiero una demo\n\n— vía reserva en Kalya')).toBe(
      'Hola\nquiero una demo',
    )
  })

  it('cuts a long preview', () => {
    const preview = messageFromNote('x'.repeat(400), 20)
    expect(preview).toHaveLength(20)
    expect(preview?.endsWith('…')).toBe(true)
  })
})

describe('namedBreakdown', () => {
  it('names the rules, drops zero parts, largest first', () => {
    const names = new Map([
      ['r1', 'Intención: solicitud de venta'],
      ['r2', 'Teléfono'],
    ])
    expect(namedBreakdown({ r2: 1, r1: 4, r3: 0, r4: -1 }, names)).toEqual([
      { rule: 'Intención: solicitud de venta', points: 4 },
      { rule: 'Teléfono', points: 1 },
      { rule: 'Regla eliminada', points: -1 },
    ])
    expect(namedBreakdown(null, names)).toEqual([])
  })
})

describe('phoneKey', () => {
  it('matches the last ten digits across formats', () => {
    expect(phoneKey('+52 (55) 0000-1111')).toBe('5500001111')
    expect(phoneKey('55 0000 1111')).toBe('5500001111')
    expect(phoneKey('123')).toBeNull()
  })
})

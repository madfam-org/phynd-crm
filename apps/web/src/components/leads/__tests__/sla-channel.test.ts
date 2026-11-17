import { describe, expect, it } from 'vitest'
import { isMaskedValue, leadChannel, mailtoHref, telHref, whatsappHref } from '../channel'
import { activeView, leadsHref, parseLeadsFilters } from '../lead-filters'
import { queueKeyAction } from '../queue/use-queue-keyboard'
import { shortDuration, slaState, timeAgo } from '../sla'

const NOW = new Date('2026-11-17T18:00:00.000Z')
const HOUR = 60 * 60 * 1000

describe('slaState (the deadline clock)', () => {
  it('counts up once overdue', () => {
    const state = slaState({ status: 'pending', dueAt: new Date(NOW.getTime() - 50 * HOUR) }, NOW)
    expect(state).toMatchObject({ kind: 'overdue', label: 'Vencida hace 2 d' })
  })

  it('warns in the last 4 hours, counts down before that', () => {
    expect(
      slaState({ status: 'pending', dueAt: new Date(NOW.getTime() + 3 * HOUR) }, NOW),
    ).toMatchObject({
      kind: 'due_soon',
      label: 'Vence en 3 h',
    })
    expect(
      slaState({ status: 'pending', dueAt: new Date(NOW.getTime() + 20 * HOUR) }, NOW).kind,
    ).toBe('on_track')
  })

  it('reads done, missing and dateless tasks plainly', () => {
    expect(slaState({ status: 'completed', dueAt: null }, NOW)).toMatchObject({
      kind: 'done',
      label: 'Contactado',
    })
    expect(slaState(null, NOW).kind).toBe('none')
    expect(slaState({ status: 'pending', dueAt: null }, NOW).kind).toBe('none')
  })

  it('accepts serialised dates', () => {
    expect(slaState({ status: 'pending', dueAt: '2026-11-17T17:30:00.000Z' }, NOW).label).toBe(
      'Vencida hace 30 min',
    )
  })

  it('formats short durations and relative times', () => {
    expect(shortDuration(20 * 1000)).toBe('1 min')
    expect(shortDuration(90 * 60 * 1000)).toBe('2 h')
    expect(timeAgo(new Date(NOW.getTime() - 5 * HOUR), NOW)).toBe('hace 5 h')
    expect(timeAgo(null, NOW)).toBe('—')
  })
})

describe('leadChannel', () => {
  it.each([
    ['kalya', 'Kalya', null],
    ['madfam-site', 'Sitio MADFAM', null],
    ['producto-comply', 'Avala', 'producto-comply'],
    ['ec_waitlist', 'Avala', 'ec_waitlist'],
    ['tezca_newsletter', 'Tezca', 'newsletter'],
    ['ceq_interest:x', 'CEQ', 'interest:x'],
    ['[redacted]', 'Oculto', null],
    [null, 'Sin origen', null],
  ])('%s → %s', (source, label, detail) => {
    expect(leadChannel(source)).toEqual({ label, detail })
  })

  it('spots masked values', () => {
    expect(isMaskedValue('[redacted]')).toBe(true)
    expect(isMaskedValue('a***@empresa-ficticia.mx')).toBe(true)
    expect(isMaskedValue('Ana Ficticia')).toBe(false)
  })
})

describe('contact links (open the user’s client, send nothing)', () => {
  it('builds tel and WhatsApp links, assuming +52 for a bare 10-digit number', () => {
    expect(telHref('55 0000 0000')).toBe('tel:+525500000000')
    expect(whatsappHref('+1 (415) 000-0000')).toBe('https://wa.me/14150000000')
    expect(whatsappHref('***0000')).toBeNull()
    expect(telHref('123')).toBeNull()
  })

  it('builds mailto only for a real address', () => {
    expect(mailtoHref('ana@empresa-ficticia.mx')).toBe('mailto:ana@empresa-ficticia.mx')
    expect(mailtoHref('a***@empresa-ficticia.mx')).toBeNull()
    expect(mailtoHref(null)).toBeNull()
  })
})

describe('views in the URL', () => {
  it('parses view and page, and maps the owner link onto a tab', () => {
    expect(parseLeadsFilters({ view: 'overdue', page: '3' })).toEqual({ view: 'overdue', page: 3 })
    expect(parseLeadsFilters({ view: 'nope', page: '0' })).toEqual({})
    expect(activeView({ owner: 'me', tier: 'A' })).toBe('mine')
    expect(activeView({ tier: 'A' })).toBe('tier_a')
    expect(activeView({ owner: 'unassigned' })).toBe('unassigned')
    expect(activeView({})).toBe('all')
  })

  it('builds links without the default view', () => {
    expect(leadsHref({ view: 'all', tier: 'B' })).toBe('/leads?tier=B')
    expect(leadsHref({ view: 'overdue', page: 2 })).toBe('/leads?view=overdue&page=2')
  })
})

describe('queue keyboard', () => {
  // No DOM here: just the bits queueKeyAction reads.
  const fake = (tagName: string, inRow: boolean) =>
    ({
      tagName,
      isContentEditable: false,
      closest: (selector: string) => (selector === '[data-lead-row]' && inRow ? {} : null),
    }) as unknown as EventTarget
  const row = fake('TR', true)
  const input = fake('INPUT', false)
  const body = fake('BODY', false)
  const key = (k: string, target: EventTarget | null = row, mods = {}) =>
    queueKeyAction({ key: k, altKey: false, ctrlKey: false, metaKey: false, target, ...mods })

  it('maps j/k, Enter, a and x', () => {
    expect(key('j')).toBe('next')
    expect(key('k')).toBe('previous')
    expect(key('Enter')).toBe('open')
    expect(key('a')).toBe('assign')
    expect(key('x')).toBe('toggle')
  })

  it('ignores typing and modifiers', () => {
    expect(key('a', input)).toBeNull()
    expect(key('a', row, { metaKey: true })).toBeNull()
    expect(key('Enter', body)).toBeNull()
  })
})

import { describe, expect, it, vi } from 'vitest'

vi.mock('@phynd/services', () => ({
  EmailService: vi.fn(),
}))

import {
  formatBookingStart,
  isLeadIntakeSource,
  leadEventSource,
  leadNotificationRecipients,
  nextBusinessDayDueAt,
} from '../lead-intake'

describe('leadEventSource', () => {
  it('maps each lead event to the one source allowed to send it', () => {
    expect(leadEventSource('kalya.booking.created')).toBe('kalya')
    expect(leadEventSource('site.lead.captured')).toBe('madfam-site')
  })

  it('returns undefined for anything else, including inherited object keys', () => {
    expect(leadEventSource('kalya.booking.cancelled')).toBeUndefined()
    expect(leadEventSource('constructor')).toBeUndefined()
    expect(leadEventSource('toString')).toBeUndefined()
  })
})

describe('isLeadIntakeSource', () => {
  it('accepts only the two known sources', () => {
    expect(isLeadIntakeSource('kalya')).toBe(true)
    expect(isLeadIntakeSource('madfam-site')).toBe(true)
    expect(isLeadIntakeSource('nauta')).toBe(false)
    expect(isLeadIntakeSource(undefined)).toBe(false)
    expect(isLeadIntakeSource(['kalya'])).toBe(false)
  })
})

describe('nextBusinessDayDueAt', () => {
  // 09:00 in Mexico City is 15:00 UTC.
  it('is the next day on a weekday', () => {
    // Monday 16 Nov 2026, 12:00 in Mexico City
    expect(nextBusinessDayDueAt(new Date('2026-11-16T18:00:00.000Z')).toISOString()).toBe(
      '2026-11-17T15:00:00.000Z',
    )
  })

  it('skips the weekend from a Friday', () => {
    expect(nextBusinessDayDueAt(new Date('2026-11-13T18:00:00.000Z')).toISOString()).toBe(
      '2026-11-16T15:00:00.000Z',
    )
  })

  it('goes to Monday from a Saturday or a Sunday', () => {
    expect(nextBusinessDayDueAt(new Date('2026-11-14T18:00:00.000Z')).toISOString()).toBe(
      '2026-11-16T15:00:00.000Z',
    )
    expect(nextBusinessDayDueAt(new Date('2026-11-15T18:00:00.000Z')).toISOString()).toBe(
      '2026-11-16T15:00:00.000Z',
    )
  })

  it('counts from the Mexico City calendar day, not the UTC one', () => {
    // Thursday 12 Nov 23:30 in Mexico City is already Friday in UTC.
    expect(nextBusinessDayDueAt(new Date('2026-11-13T05:30:00.000Z')).toISOString()).toBe(
      '2026-11-13T15:00:00.000Z',
    )
    // Friday 13 Nov 20:00 in Mexico City is already Saturday in UTC.
    expect(nextBusinessDayDueAt(new Date('2026-11-14T02:00:00.000Z')).toISOString()).toBe(
      '2026-11-16T15:00:00.000Z',
    )
  })

  it('crosses a month and a year boundary', () => {
    // Thursday 31 Dec 2026
    expect(nextBusinessDayDueAt(new Date('2026-12-31T18:00:00.000Z')).toISOString()).toBe(
      '2027-01-01T15:00:00.000Z',
    )
  })
})

describe('formatBookingStart', () => {
  it('shows the local time and the zone name', () => {
    const text = formatBookingStart('2026-11-17T16:00:00.000Z', 'America/Mexico_City')
    expect(text).toContain('17 nov 2026')
    expect(text).toContain('10:00')
    expect(text).toContain('(America/Mexico_City)')
  })

  it('uses the zone the booking was made in', () => {
    const text = formatBookingStart('2026-11-17T16:00:00.000Z', 'Europe/Madrid')
    expect(text).toContain('5:00')
    expect(text).toContain('(Europe/Madrid)')
  })

  it('falls back to Mexico City for a missing or unknown zone', () => {
    expect(formatBookingStart('2026-11-17T16:00:00.000Z', undefined)).toContain(
      '(America/Mexico_City)',
    )
    const text = formatBookingStart('2026-11-17T16:00:00.000Z', 'Not/AZone')
    expect(text).toContain('10:00')
    expect(text).toContain('(America/Mexico_City)')
  })

  it('returns a value that is not a date as it was sent, and nothing for no value', () => {
    expect(formatBookingStart('mañana a las 10', 'America/Mexico_City')).toBe('mañana a las 10')
    expect(formatBookingStart(undefined, 'America/Mexico_City')).toBeUndefined()
  })
})

describe('leadNotificationRecipients', () => {
  it('reads LEADS_NOTIFY_EMAIL as a comma-separated list', () => {
    expect(
      leadNotificationRecipients({ LEADS_NOTIFY_EMAIL: ' a@example.test , b@example.test,, ' }),
    ).toEqual(['a@example.test', 'b@example.test'])
  })

  it('falls back to NAUTA_LEADS_NOTIFY_EMAIL while LEADS_NOTIFY_EMAIL is unset or empty', () => {
    expect(leadNotificationRecipients({ NAUTA_LEADS_NOTIFY_EMAIL: 'n@example.test' })).toEqual([
      'n@example.test',
    ])
    expect(
      leadNotificationRecipients({
        LEADS_NOTIFY_EMAIL: '  ',
        NAUTA_LEADS_NOTIFY_EMAIL: 'n@example.test',
      }),
    ).toEqual(['n@example.test'])
  })

  it('prefers LEADS_NOTIFY_EMAIL and returns nothing when neither is set', () => {
    expect(
      leadNotificationRecipients({
        LEADS_NOTIFY_EMAIL: 'a@example.test',
        NAUTA_LEADS_NOTIFY_EMAIL: 'n@example.test',
      }),
    ).toEqual(['a@example.test'])
    expect(leadNotificationRecipients({})).toEqual([])
  })
})

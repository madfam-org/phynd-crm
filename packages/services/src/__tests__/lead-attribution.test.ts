import { describe, expect, it } from 'vitest'
import {
  LEAD_ATTRIBUTION_MAX_LENGTH,
  LEAD_ATTRIBUTION_URL_MAX_LENGTH,
  sanitizeLeadAttribution,
} from '../leads/lead-attribution'

describe('sanitizeLeadAttribution', () => {
  it('keeps the known keys, trimmed', () => {
    expect(
      sanitizeLeadAttribution({
        landing_page: ' https://example.test/precios ',
        referrer: 'https://search.example.test/',
        utm_campaign: 'otono',
        utm_content: 'banner-a',
        utm_medium: 'cpc',
        utm_source: '  buscador ',
        utm_term: 'crm',
      }),
    ).toEqual({
      landing_page: 'https://example.test/precios',
      referrer: 'https://search.example.test/',
      utm_campaign: 'otono',
      utm_content: 'banner-a',
      utm_medium: 'cpc',
      utm_source: 'buscador',
      utm_term: 'crm',
    })
  })

  it('drops unknown keys and non-string values', () => {
    expect(
      sanitizeLeadAttribution({
        gclid: 'abc',
        nested: { utm_source: 'x' },
        utm_campaign: ['a'],
        utm_medium: 7,
        utm_source: 'newsletter',
        utm_term: null,
      }),
    ).toEqual({ utm_source: 'newsletter' })
  })

  it('cuts values to their maximum length', () => {
    const result = sanitizeLeadAttribution({
      landing_page: `https://example.test/${'p'.repeat(600)}`,
      referrer: 'r'.repeat(LEAD_ATTRIBUTION_URL_MAX_LENGTH + 1),
      utm_source: 's'.repeat(LEAD_ATTRIBUTION_MAX_LENGTH + 50),
    })
    expect(result?.utm_source).toHaveLength(LEAD_ATTRIBUTION_MAX_LENGTH)
    expect(result?.referrer).toHaveLength(LEAD_ATTRIBUTION_URL_MAX_LENGTH)
    expect(result?.landing_page).toHaveLength(LEAD_ATTRIBUTION_URL_MAX_LENGTH)
  })

  it('keeps only the known booking fields', () => {
    expect(
      sanitizeLeadAttribution({
        booking: {
          attendee_email: 'someone@example.test',
          event_type_name: ' Diagnóstico ',
          host_name: 'Anfitrión',
          id: 'bk-1',
          starts_at: '2026-11-17T16:00:00.000Z',
          timezone: 'America/Mexico_City',
          video_url: 'https://meet.example.test/x',
        },
      }),
    ).toEqual({
      booking: {
        event_type_name: 'Diagnóstico',
        host_name: 'Anfitrión',
        id: 'bk-1',
        starts_at: '2026-11-17T16:00:00.000Z',
        timezone: 'America/Mexico_City',
      },
    })
  })

  it('leaves the booking out when none of its fields is usable', () => {
    expect(sanitizeLeadAttribution({ booking: { id: 12 }, utm_source: 'x' })).toEqual({
      utm_source: 'x',
    })
    expect(sanitizeLeadAttribution({ booking: 'bk-1', utm_source: 'x' })).toEqual({
      utm_source: 'x',
    })
  })

  it('returns null when nothing remains', () => {
    expect(sanitizeLeadAttribution({})).toBeNull()
    expect(sanitizeLeadAttribution({ gclid: 'abc', utm_source: '   ' })).toBeNull()
    expect(sanitizeLeadAttribution(null)).toBeNull()
    expect(sanitizeLeadAttribution(undefined)).toBeNull()
    expect(sanitizeLeadAttribution('utm_source=x')).toBeNull()
    expect(sanitizeLeadAttribution(['utm_source'])).toBeNull()
  })

  it('is idempotent', () => {
    const once = sanitizeLeadAttribution({
      booking: { id: 'bk-1' },
      utm_source: 's'.repeat(400),
    })
    expect(sanitizeLeadAttribution(once)).toEqual(once)
  })
})

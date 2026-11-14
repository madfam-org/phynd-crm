import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LeadAttributionCard, leadAttributionRows } from '../lead-attribution'

describe('leadAttributionRows', () => {
  it('lists only the fields the lead has, in display order', () => {
    expect(
      leadAttributionRows({
        landing_page: 'https://sitio.example.test/contacto',
        utm_campaign: 'otono-2026',
        utm_source: 'boletin',
      }).map(([label]) => label),
    ).toEqual(['UTM source', 'UTM campaign', 'Landing page'])
  })

  it('shows the meeting with its time zone', () => {
    const rows = new Map(
      leadAttributionRows({
        booking: {
          event_type_name: 'Diagnóstico',
          host_name: 'Anfitrión Ejemplo',
          id: 'bk_123',
          starts_at: '2026-11-17T16:00:00.000Z',
          timezone: 'America/Mexico_City',
        },
      }),
    )
    expect(rows.get('Meeting type')).toBe('Diagnóstico')
    expect(rows.get('Meeting host')).toBe('Anfitrión Ejemplo')
    expect(rows.get('Booking ID')).toBe('bk_123')
    expect(rows.get('Meeting start')).toContain('10:00')
    expect(rows.get('Meeting start')).toContain('(America/Mexico_City)')
  })

  it('shows the tenant and the quote, its number before its id', () => {
    const rows = new Map(
      leadAttributionRows({
        tenant: 'taller-ejemplo',
        quote_id: 'cq_1',
        quote_number: 'Q-1',
        quote_total: '100.50',
        quote_currency: 'MXN',
      }),
    )
    expect(rows.get('Tenant')).toBe('taller-ejemplo')
    expect(rows.get('Quote')).toBe('Q-1')
    expect(rows.get('Quote total')).toBe('100.50 MXN')
    const unpriced = new Map(leadAttributionRows({ quote_id: 'cq_2' }))
    expect(unpriced.get('Quote')).toBe('cq_2')
    expect(unpriced.has('Quote total')).toBe(false)
  })

  it('shows a start that is not a date as stored', () => {
    const rows = new Map(leadAttributionRows({ booking: { starts_at: 'mañana a las 10' } }))
    expect(rows.get('Meeting start')).toBe('mañana a las 10')
  })

  it('is empty without attribution', () => {
    expect(leadAttributionRows(null)).toEqual([])
    expect(leadAttributionRows(undefined)).toEqual([])
    expect(leadAttributionRows({})).toEqual([])
  })
})

describe('LeadAttributionCard', () => {
  it('renders nothing when the lead has no attribution', () => {
    expect(renderToStaticMarkup(<LeadAttributionCard attribution={null} />)).toBe('')
  })

  it('renders the stored values as text', () => {
    const html = renderToStaticMarkup(
      <LeadAttributionCard
        attribution={{ referrer: 'https://ref.example.test/?a=<b>', utm_source: 'buscador' }}
      />,
    )
    expect(html).toContain('Attribution')
    expect(html).toContain('UTM source')
    expect(html).toContain('buscador')
    expect(html).toContain('https://ref.example.test/?a=&lt;b&gt;')
    expect(html).not.toContain('<a ')
  })
})

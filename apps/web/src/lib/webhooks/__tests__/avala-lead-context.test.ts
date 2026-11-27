import { describe, expect, it } from 'vitest'
// The owner-run backfill inlines the same rules (it is also piped on stdin);
// these tests fail when the two drift apart.
import * as backfill from '../../../../../../scripts/backfill-avala-lead-context.mjs'
import {
  AVALA_SERVICE_ACTOR,
  avalaFirstContactDescription,
  avalaLeadAttribution,
  avalaLeadNote,
  isAvalaWaitlistLead,
  readAvalaLeadContext,
} from '../avala-lead-context'

const SALES_REQUEST = {
  lead: {
    id: 'avala-lead-1',
    email: 'lead.uno@example.org',
    name: 'Lead Uno',
    source: 'marketing_contact',
    leadType: 'ORGANIZATION',
    message: 'Queremos una demostración para el equipo.',
    interests: ['demo', ' compliance ', 7, ''],
  },
  attribution: {
    sourcePage: '/contacto',
    intent: 'sales-request',
    utmSource: 'boletin',
    utmMedium: 'email',
    utmCampaign: 'otono',
  },
}

const WAITLIST = {
  lead: {
    id: 'avala-lead-2',
    email: 'lead.dos@example.org',
    source: 'ec_waitlist',
    ecCode: 'EC0000',
    interests: ['waitlist'],
  },
  attribution: { sourcePage: '/explorar/estandares/EC0000' },
}

const MALFORMED = { lead: { interests: 'demo', leadType: 42 }, attribution: [] }

const LONG = {
  lead: { leadType: 'x'.repeat(400), interests: Array.from({ length: 30 }, (_, i) => `i${i}`) },
  attribution: { sourcePage: `/${'p'.repeat(700)}` },
}

describe('readAvalaLeadContext', () => {
  it('reads the message, lead type, standard, intent, interests, page and campaign', () => {
    expect(readAvalaLeadContext(SALES_REQUEST)).toEqual({
      avalaLeadId: 'avala-lead-1',
      source: 'marketing_contact',
      message: 'Queremos una demostración para el equipo.',
      leadType: 'ORGANIZATION',
      ecCode: undefined,
      intent: 'sales-request',
      interests: ['demo', 'compliance'],
      sourcePage: '/contacto',
      utmSource: 'boletin',
      utmMedium: 'email',
      utmCampaign: 'otono',
    })
  })

  it('leaves malformed fields out and defaults the source', () => {
    const context = readAvalaLeadContext(MALFORMED)
    expect(context.source).toBe('avala')
    expect(context.leadType).toBeUndefined()
    expect(context.interests).toEqual([])
  })
})

describe('avalaLeadAttribution', () => {
  it('keeps page, campaign and lead type in the attribution shape', () => {
    expect(avalaLeadAttribution(readAvalaLeadContext(SALES_REQUEST))).toEqual({
      utm_source: 'boletin',
      utm_medium: 'email',
      utm_campaign: 'otono',
      landing_page: '/contacto',
      lead_type: 'ORGANIZATION',
    })
    expect(avalaLeadAttribution(readAvalaLeadContext(MALFORMED))).toBeNull()
  })
})

describe('avalaLeadNote', () => {
  it('starts with the message, then the context lines', () => {
    expect(avalaLeadNote(readAvalaLeadContext(SALES_REQUEST))).toBe(
      [
        'Queremos una demostración para el equipo.',
        '',
        '— vía formulario de Avala · /contacto',
        '— origen en Avala: marketing_contact',
        '— tipo de lead: ORGANIZATION',
        '— intención: sales-request',
        '— intereses: demo, compliance',
      ].join('\n'),
    )
  })

  it('marks a waitlist entry as not a sales target', () => {
    const context = readAvalaLeadContext(WAITLIST)
    expect(isAvalaWaitlistLead(context)).toBe(true)
    const note = avalaLeadNote(context)
    expect(note.split('\n')[0]).toBe('(sin mensaje)')
    expect(note).toContain('— estándar: EC0000')
    expect(note).toContain('no es un prospecto de venta')
    expect(avalaFirstContactDescription(context)).toBe(
      'Lead por formulario de Avala. Estándar: EC0000. Lista de espera: no es un prospecto de venta; avisar cuando el estándar esté disponible.',
    )
  })

  it('asks to read the message first on a lead that sent one', () => {
    expect(avalaFirstContactDescription(readAvalaLeadContext(SALES_REQUEST))).toBe(
      'Lead por formulario de Avala. Lee su mensaje en las notas del lead antes de contactar.',
    )
  })
})

describe('the backfill script writes what the receiver writes', () => {
  it('uses the same author', () => {
    expect(backfill.AVALA_SERVICE_ACTOR).toBe(AVALA_SERVICE_ACTOR)
  })

  for (const [name, payload] of Object.entries({ SALES_REQUEST, WAITLIST, MALFORMED, LONG })) {
    it(`same context, note and attribution for ${name}`, () => {
      const context = readAvalaLeadContext(payload)
      expect(backfill.readAvalaLeadContext(payload)).toEqual(context)
      expect(backfill.avalaLeadNote(context)).toBe(avalaLeadNote(context))
      expect(backfill.avalaLeadAttribution(context)).toEqual(avalaLeadAttribution(context))
    })
  }
})

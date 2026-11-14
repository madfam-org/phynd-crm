import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Scaffolding cloned from the nauta webhook tests one directory over — same
// signature scheme, same env, same dedup contract, so the same mocks.

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 99 })
vi.mock('@/lib/webhooks/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

vi.mock('@/lib/federation/clients', () => ({
  getCacheManager: () => ({}),
}))

vi.mock('@phynd/config/constants', () => ({
  DEFAULT_TENANT_ID: 'madfam',
}))

const state = {
  insertedWebhookEvents: [] as Array<Record<string, unknown>>,
  seenEventIds: [] as string[],
  dedupLookups: [] as unknown[],
}

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn((condition: unknown) => {
        state.dedupLookups.push(condition)
        return {
          limit: vi
            .fn()
            .mockImplementation(() =>
              Promise.resolve(state.seenEventIds.length > 0 ? [{ id: 'prior' }] : []),
            ),
        }
      }),
    })),
  })),
  insert: vi.fn(() => ({
    values: vi.fn((value: Record<string, unknown>) => {
      state.insertedWebhookEvents.push(value)
      return Promise.resolve()
    }),
  })),
}

vi.mock('@phynd/db', () => ({
  getDb: () => mockDb,
}))

vi.mock('@phynd/db/schema', () => ({
  webhookEvents: {
    id: 'webhook_events.id',
    provider: 'webhook_events.provider',
    payload: 'webhook_events.payload',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ __and: args }),
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sql: String.raw({ raw: strings }, ...values.map((v) => String(v))),
  }),
}))

const mockContact = { id: 'contact-1', email: 'prospecto@example.test', externalJanuaId: null }
const mockLead = { id: 'lead-1' }

const mockGetByEmail = vi.fn().mockResolvedValue(null)
const mockCreateContact = vi.fn().mockResolvedValue(mockContact)
const mockUpdateContact = vi.fn()
const mockGetDefaultPipeline = vi.fn().mockResolvedValue({ id: 'pipeline-1' })
const mockGetStages = vi.fn().mockResolvedValue([{ id: 'stage-1' }, { id: 'stage-2' }])
const mockCreateLead = vi.fn().mockResolvedValue(mockLead)
const mockCreateNote = vi.fn().mockResolvedValue({ id: 'note-1' })
const mockCreateActivity = vi.fn().mockResolvedValue({ id: 'activity-1' })
const mockSendEmail = vi.fn().mockResolvedValue({ id: 'resend-msg-1' })
const serviceContexts: Array<{ auth: { userId: string } }> = []

vi.mock('@phynd/services', () => ({
  createServiceContext: (db: unknown, _cache: unknown, auth: { userId: string }) => {
    const ctx = { db, auth }
    serviceContexts.push(ctx)
    return ctx
  },
  ContactsService: vi.fn().mockImplementation(() => ({
    getByEmail: mockGetByEmail,
    create: mockCreateContact,
    update: mockUpdateContact,
  })),
  LeadsService: vi.fn().mockImplementation(() => ({
    create: mockCreateLead,
  })),
  PipelinesService: vi.fn().mockImplementation(() => ({
    getDefault: mockGetDefaultPipeline,
    getStages: mockGetStages,
  })),
  NotesService: vi.fn().mockImplementation(() => ({
    create: mockCreateNote,
  })),
  ActivitiesService: vi.fn().mockImplementation(() => ({
    create: mockCreateActivity,
  })),
  EmailService: vi.fn().mockImplementation(() => ({
    send: mockSendEmail,
  })),
}))

import { POST } from '../route'

const SECRET = 'DUMMY_WEBHOOK_SECRET_DO_NOT_USE'
const ORIGINAL_SECRET = process.env.PHYND_CRM_EVENTS_SECRET
const BOOKING_EVENT_ID = '0b6f6b0e-52a5-4c0c-9a53-6f6f2c1d0001'
const SITE_EVENT_ID = '0b6f6b0e-52a5-4c0c-9a53-6f6f2c1d0002'

function signedRequest(body: string, headerOverride?: string): Request {
  const ts = Math.floor(Date.now() / 1000)
  const hmac = crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex')
  const header = headerOverride ?? `t=${ts},v1=${hmac}`
  return new Request('http://localhost/api/webhooks/lead-intake', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-madfam-signature': header,
      'x-forwarded-for': '10.0.0.1',
    },
    body,
  })
}

type Payload = {
  lead: Record<string, unknown>
  context?: Record<string, unknown>
  attribution?: Record<string, unknown>
  booking?: Record<string, unknown>
}

function makeBookingEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schema_version: '1',
    event_id: BOOKING_EVENT_ID,
    event_type: 'kalya.booking.created',
    source: 'kalya',
    occurred_at: '2026-11-13T18:00:00.000Z',
    payload: {
      lead: {
        name: 'Ana Prospecto',
        email: 'prospecto@example.test',
        phone: '+52 55 0000 0000',
        company: 'Empresa Ejemplo',
        message: 'Quiero revisar el alcance antes de la llamada.',
      },
      context: {
        page: 'https://agenda.example.test/equipo/diagnostico',
        locale: 'es-MX',
        tenant: 'equipo',
      },
      attribution: {
        utm_source: 'boletin',
        utm_medium: 'email',
        utm_campaign: 'otono-2026',
        referrer: 'https://sitio.example.test/servicios',
      },
      booking: {
        id: 'bk_123',
        event_type_name: 'Diagnóstico de 30 minutos',
        starts_at: '2026-11-17T16:00:00.000Z',
        timezone: 'America/Mexico_City',
        host_name: 'Anfitrión Ejemplo',
      },
    } as Payload,
    ...overrides,
  }
}

function makeSiteEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schema_version: '1',
    event_id: SITE_EVENT_ID,
    event_type: 'site.lead.captured',
    source: 'madfam-site',
    occurred_at: '2026-11-13T18:05:00.000Z',
    payload: {
      lead: {
        name: 'Luis Visitante',
        email: 'visitante@example.test',
        company: 'Taller Ejemplo',
        message: 'Necesitamos una cotización para 40 piezas.',
      },
      context: {
        page: 'https://sitio.example.test/contacto',
        locale: 'es-MX',
        plan_interest: 'fabricacion',
      },
      attribution: {
        utm_source: 'buscador',
        utm_medium: 'cpc',
        utm_campaign: 'fabricacion-q4',
        utm_content: 'anuncio-b',
        utm_term: 'corte laser',
        referrer: 'https://search.example.test/',
      },
    } as Payload,
    ...overrides,
  }
}

function post(event: unknown, headerOverride?: string) {
  return POST(signedRequest(JSON.stringify(event), headerOverride))
}

function sentEmail() {
  return mockSendEmail.mock.calls[0]?.[0] as {
    to: string
    subject: string
    html: string
    preheader: string
    tags: Array<{ name: string; value: string }>
  }
}

beforeEach(() => {
  process.env.PHYND_CRM_EVENTS_SECRET = SECRET
  process.env.LEADS_NOTIFY_EMAIL = 'ventas@example.test'
  delete process.env.NAUTA_LEADS_NOTIFY_EMAIL
  state.insertedWebhookEvents = []
  state.seenEventIds = []
  state.dedupLookups = []
  serviceContexts.length = 0
  mockCheckRateLimit.mockClear().mockResolvedValue({ allowed: true, remaining: 99 })
  mockDb.select.mockClear()
  mockDb.insert.mockClear()
  mockGetByEmail.mockReset().mockResolvedValue(null)
  mockCreateContact.mockClear().mockResolvedValue(mockContact)
  mockUpdateContact.mockClear()
  mockGetDefaultPipeline.mockClear().mockResolvedValue({ id: 'pipeline-1' })
  mockGetStages.mockClear().mockResolvedValue([{ id: 'stage-1' }, { id: 'stage-2' }])
  mockCreateLead.mockClear().mockResolvedValue(mockLead)
  mockCreateNote.mockClear().mockResolvedValue({ id: 'note-1' })
  mockCreateActivity.mockReset().mockResolvedValue({ id: 'activity-1' })
  mockSendEmail.mockReset().mockResolvedValue({ id: 'resend-msg-1' })
})

afterEach(() => {
  delete process.env.LEADS_NOTIFY_EMAIL
  delete process.env.NAUTA_LEADS_NOTIFY_EMAIL
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.PHYND_CRM_EVENTS_SECRET
  } else {
    process.env.PHYND_CRM_EVENTS_SECRET = ORIGINAL_SECRET
  }
})

describe('POST /api/webhooks/lead-intake — envelope', () => {
  it('fails closed with 503 when the secret is not configured', async () => {
    delete process.env.PHYND_CRM_EVENTS_SECRET
    const res = await post(makeBookingEvent())
    expect(res.status).toBe(503)
    expect(mockCreateContact).not.toHaveBeenCalled()
  })

  it('rejects a bad signature with 401 and touches nothing', async () => {
    const res = await post(makeBookingEvent(), 't=1,v1=deadbeef')
    expect(res.status).toBe(401)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(state.insertedWebhookEvents).toHaveLength(0)
  })

  it('rate limits before reading the body', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 })
    const res = await post(makeBookingEvent())
    expect(res.status).toBe(429)
  })

  it('rejects a body that is not JSON with 400', async () => {
    const res = await POST(signedRequest('not json'))
    expect(res.status).toBe(400)
  })

  it('requires event_id and event_type', async () => {
    expect((await post(makeBookingEvent({ event_id: undefined }))).status).toBe(400)
    expect((await post(makeBookingEvent({ event_type: '' }))).status).toBe(400)
    expect(mockCreateContact).not.toHaveBeenCalled()
  })

  it('rejects an unknown source with 400', async () => {
    const res = await post(makeBookingEvent({ source: 'nauta' }))
    expect(res.status).toBe(400)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(state.insertedWebhookEvents).toHaveLength(0)
  })

  it('rejects a mismatched source and event type with 400', async () => {
    const bookingFromSite = await post(makeBookingEvent({ source: 'madfam-site' }))
    expect(bookingFromSite.status).toBe(400)
    const siteLeadFromKalya = await post(makeSiteEvent({ source: 'kalya' }))
    expect(siteLeadFromKalya.status).toBe(400)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(mockCreateLead).not.toHaveBeenCalled()
    expect(state.insertedWebhookEvents).toHaveLength(0)
  })

  it('deduplicates by event_id per source: a retry is acknowledged and creates nothing', async () => {
    state.seenEventIds = [BOOKING_EVENT_ID]
    const res = await post(makeBookingEvent())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { deduplicated?: boolean }
    expect(body.deduplicated).toBe(true)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(mockCreateLead).not.toHaveBeenCalled()
    expect(mockCreateNote).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(state.insertedWebhookEvents).toHaveLength(0)
    // The lookup is scoped to the sender: the source is the provider.
    expect(JSON.stringify(state.dedupLookups[0])).toContain('"webhook_events.provider","kalya"')
    expect(JSON.stringify(state.dedupLookups[0])).toContain(BOOKING_EVENT_ID)
  })

  it('acknowledges and records an unknown event type from a known source', async () => {
    const res = await post(makeBookingEvent({ event_type: 'kalya.booking.rescheduled' }))
    expect(res.status).toBe(200)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(state.insertedWebhookEvents).toHaveLength(1)
    expect(state.insertedWebhookEvents[0]?.provider).toBe('kalya')
    expect(state.insertedWebhookEvents[0]?.eventType).toBe('kalya.booking.rescheduled')
  })
})

describe('POST /api/webhooks/lead-intake — Kalya booking', () => {
  it('creates the contact, the lead with source and attribution, the note and the notification', async () => {
    const res = await post(makeBookingEvent())
    expect(res.status).toBe(200)

    expect(mockCreateContact).toHaveBeenCalledWith({
      name: 'Ana Prospecto',
      email: 'prospecto@example.test',
      phone: '+52 55 0000 0000',
      company: 'Empresa Ejemplo',
    })
    expect(mockCreateLead).toHaveBeenCalledWith({
      contactId: 'contact-1',
      source: 'kalya',
      attribution: {
        utm_source: 'boletin',
        utm_medium: 'email',
        utm_campaign: 'otono-2026',
        referrer: 'https://sitio.example.test/servicios',
        landing_page: 'https://agenda.example.test/equipo/diagnostico',
        booking: {
          id: 'bk_123',
          starts_at: '2026-11-17T16:00:00.000Z',
          event_type_name: 'Diagnóstico de 30 minutos',
          host_name: 'Anfitrión Ejemplo',
          timezone: 'America/Mexico_City',
        },
      },
      pipelineId: 'pipeline-1',
      stageId: 'stage-1',
    })

    expect(mockCreateNote).toHaveBeenCalledTimes(1)
    const note = mockCreateNote.mock.calls[0]?.[0] as {
      content: string
      entityType: string
      entityId: string
    }
    expect(note.entityType).toBe('contact')
    expect(note.entityId).toBe('contact-1')
    const [message, blank, ...origin] = note.content.split('\n')
    expect(message).toBe('Quiero revisar el alcance antes de la llamada.')
    expect(blank).toBe('')
    expect(origin[0]).toBe(
      '— vía reserva en Kalya · https://agenda.example.test/equipo/diagnostico',
    )
    expect(origin[1]).toContain('— reunión: Diagnóstico de 30 minutos · 17 nov 2026')
    expect(origin[1]).toContain('10:00')
    expect(origin[1]).toContain('(America/Mexico_City) · con Anfitrión Ejemplo')
    expect(origin[2]).toBe('— utm: boletin / email / otono-2026')

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const email = sentEmail()
    expect(email.to).toBe('ventas@example.test')
    expect(email.subject).toBe('Nueva reserva en Kalya: Ana Prospecto (Empresa Ejemplo)')
    expect(email.html).toContain('Nuevo lead — reserva en Kalya')
    expect(email.html).toContain('Diagnóstico de 30 minutos')
    expect(email.html).toContain('17 nov 2026')
    expect(email.html).toContain('(America/Mexico_City)')
    expect(email.html).toContain('Anfitrión Ejemplo')
    expect(email.html).toContain('boletin')
    expect(email.html).toContain('otono-2026')
    expect(email.html).toContain('Quiero revisar el alcance antes de la llamada.')
    expect(email.html).toContain('https://crm.madfam.io/leads/lead-1')
    expect(email.tags).toEqual([
      { name: 'source', value: 'kalya' },
      { name: 'lead_id', value: 'lead-1' },
      { name: 'contact_id', value: 'contact-1' },
    ])

    expect(state.insertedWebhookEvents).toHaveLength(1)
    expect(state.insertedWebhookEvents[0]?.provider).toBe('kalya')
    expect(state.insertedWebhookEvents[0]?.eventType).toBe('kalya.booking.created')
    expect(serviceContexts[0]?.auth.userId).toBe('service:kalya')
  })

  it('opens one unowned follow-up task on the lead, due the next business day', async () => {
    const before = Date.now()
    const res = await post(makeBookingEvent())
    expect(res.status).toBe(200)

    expect(mockCreateActivity).toHaveBeenCalledTimes(1)
    const task = mockCreateActivity.mock.calls[0]?.[0] as {
      type: string
      title: string
      description: string
      dueAt: Date
      entityType: string
      entityId: string
      ownerId: string | null
    }
    expect(task.type).toBe('task')
    expect(task.title).toBe('Dar seguimiento: Ana Prospecto')
    expect(task.description).toContain('reserva en Kalya')
    expect(task.description).toContain('Diagnóstico de 30 minutos')
    expect(task.entityType).toBe('lead')
    expect(task.entityId).toBe('lead-1')
    expect(task.ownerId).toBeNull()
    expect(task.dueAt.getTime()).toBeGreaterThan(before)
    expect(task.dueAt.getTime() - before).toBeLessThanOrEqual(4 * 24 * 60 * 60 * 1000)
    expect([1, 2, 3, 4, 5]).toContain(task.dueAt.getUTCDay())
    expect(task.dueAt.getUTCHours()).toBe(15)
    expect(sentEmail().html).toContain('Tarea de seguimiento en el CRM')
  })

  it('still returns 200 when the follow-up task cannot be created', async () => {
    mockCreateActivity.mockRejectedValue(new Error('activity insert failed'))
    const res = await post(makeBookingEvent())
    expect(res.status).toBe(200)
    expect(mockCreateLead).toHaveBeenCalled()
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(sentEmail().html).not.toContain('Tarea de seguimiento en el CRM')
    expect(state.insertedWebhookEvents).toHaveLength(1)
  })
})

describe('POST /api/webhooks/lead-intake — site lead', () => {
  it('creates the contact and a lead with source madfam-site and the UTM parameters', async () => {
    const res = await post(makeSiteEvent())
    expect(res.status).toBe(200)

    expect(mockCreateContact).toHaveBeenCalledWith({
      name: 'Luis Visitante',
      email: 'visitante@example.test',
      phone: undefined,
      company: 'Taller Ejemplo',
    })
    expect(mockCreateLead).toHaveBeenCalledWith({
      contactId: 'contact-1',
      source: 'madfam-site',
      attribution: {
        utm_source: 'buscador',
        utm_medium: 'cpc',
        utm_campaign: 'fabricacion-q4',
        utm_content: 'anuncio-b',
        utm_term: 'corte laser',
        referrer: 'https://search.example.test/',
        landing_page: 'https://sitio.example.test/contacto',
      },
      pipelineId: 'pipeline-1',
      stageId: 'stage-1',
    })

    const note = mockCreateNote.mock.calls[0]?.[0] as { content: string }
    expect(note.content.split('\n')).toEqual([
      'Necesitamos una cotización para 40 piezas.',
      '',
      '— vía formulario del sitio · https://sitio.example.test/contacto · interés: fabricacion',
      '— utm: buscador / cpc / fabricacion-q4',
    ])

    const email = sentEmail()
    expect(email.subject).toBe('Nuevo lead del sitio: Luis Visitante (Taller Ejemplo)')
    expect(email.html).toContain('Nuevo lead — formulario del sitio')
    expect(email.html).toContain('buscador')
    expect(email.html).toContain('fabricacion-q4')
    expect(email.html).toContain('fabricacion')
    expect(email.html).not.toContain('Tipo de reunión')
    expect(email.tags).toContainEqual({ name: 'source', value: 'madfam-site' })

    expect(state.insertedWebhookEvents[0]?.provider).toBe('madfam-site')
    expect(serviceContexts[0]?.auth.userId).toBe('service:madfam-site')
  })

  it('ignores a booking object on a site lead', async () => {
    const event = makeSiteEvent()
    event.payload.booking = { id: 'bk_999', starts_at: '2026-11-17T16:00:00.000Z' }
    const res = await post(event)
    expect(res.status).toBe(200)
    const lead = mockCreateLead.mock.calls[0]?.[0] as { attribution: Record<string, unknown> }
    expect(lead.attribution.booking).toBeUndefined()
  })

  it('stores null attribution and a "(sin mensaje)" note for a bare lead', async () => {
    const res = await post(
      makeSiteEvent({ payload: { lead: { name: 'Solo Correo', email: 'solo@example.test' } } }),
    )
    expect(res.status).toBe(200)
    const lead = mockCreateLead.mock.calls[0]?.[0] as { attribution: unknown }
    expect(lead.attribution).toBeNull()
    const note = mockCreateNote.mock.calls[0]?.[0] as { content: string }
    expect(note.content.split('\n')).toEqual(['(sin mensaje)', '', '— vía formulario del sitio'])
  })

  it('drops unknown attribution keys and cuts oversized values', async () => {
    const event = makeSiteEvent()
    event.payload.context = { page: `https://sitio.example.test/${'p'.repeat(700)}` }
    event.payload.attribution = {
      utm_source: 's'.repeat(400),
      utm_medium: 42,
      utm_campaign: { nested: 'x' },
      referrer: `https://ref.example.test/${'r'.repeat(700)}`,
      gclid: 'abc123',
      landing_page: 'https://other.example.test/spoofed',
      booking: { id: 'bk_1' },
    }
    const res = await post(event)
    expect(res.status).toBe(200)

    const lead = mockCreateLead.mock.calls[0]?.[0] as { attribution: Record<string, string> }
    expect(Object.keys(lead.attribution).sort()).toEqual(['landing_page', 'referrer', 'utm_source'])
    expect(lead.attribution.utm_source).toBe('s'.repeat(255))
    expect(lead.attribution.referrer).toHaveLength(500)
    // landing_page comes from context.page only, never from the attribution block.
    expect(lead.attribution.landing_page).toHaveLength(500)
    expect(lead.attribution.landing_page?.startsWith('https://sitio.example.test/')).toBe(true)
  })
})

describe('POST /api/webhooks/lead-intake — contacts', () => {
  it('reuses an existing contact and never overwrites it', async () => {
    mockGetByEmail.mockResolvedValue({
      ...mockContact,
      id: 'contact-existing',
      name: 'Nombre Anterior',
      company: 'Empresa Anterior',
    })
    const res = await post(makeBookingEvent())
    expect(res.status).toBe(200)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(mockUpdateContact).not.toHaveBeenCalled()
    expect(mockCreateLead).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'contact-existing', source: 'kalya' }),
    )
    const note = mockCreateNote.mock.calls[0]?.[0] as { entityId: string }
    expect(note.entityId).toBe('contact-existing')
    expect(sentEmail().tags).toContainEqual({ name: 'contact_id', value: 'contact-existing' })
  })

  it('matches an address sent in mixed case against the lower-case contact', async () => {
    mockGetByEmail.mockImplementation((email: string) =>
      Promise.resolve(email === 'prospecto@example.test' ? mockContact : null),
    )
    const event = makeBookingEvent()
    event.payload.lead.email = 'Prospecto@Example.test'
    const res = await post(event)
    expect(res.status).toBe(200)
    expect(mockGetByEmail).toHaveBeenNthCalledWith(1, 'Prospecto@Example.test')
    expect(mockGetByEmail).toHaveBeenNthCalledWith(2, 'prospecto@example.test')
    expect(mockCreateContact).not.toHaveBeenCalled()
  })

  it('creates nothing when the lead has no email, and still records the event', async () => {
    const event = makeSiteEvent()
    event.payload.lead = { name: 'Sin Correo', message: 'Hola' }
    const res = await post(event)
    expect(res.status).toBe(200)
    expect(mockGetByEmail).not.toHaveBeenCalled()
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(mockCreateLead).not.toHaveBeenCalled()
    expect(mockCreateNote).not.toHaveBeenCalled()
    expect(mockCreateActivity).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(state.insertedWebhookEvents).toHaveLength(1)
  })
})

describe('POST /api/webhooks/lead-intake — notification', () => {
  it('a failed send never bounces the webhook: the lead is already stored', async () => {
    mockSendEmail.mockRejectedValue(new Error('email provider down'))
    const res = await post(makeSiteEvent())
    expect(res.status).toBe(200)
    expect(mockCreateLead).toHaveBeenCalled()
    expect(state.insertedWebhookEvents).toHaveLength(1)
  })

  it('falls back to NAUTA_LEADS_NOTIFY_EMAIL while LEADS_NOTIFY_EMAIL is unset', async () => {
    delete process.env.LEADS_NOTIFY_EMAIL
    process.env.NAUTA_LEADS_NOTIFY_EMAIL = 'uno@example.test, dos@example.test'
    const res = await post(makeSiteEvent())
    expect(res.status).toBe(200)
    expect(sentEmail().to).toBe('uno@example.test,dos@example.test')
  })

  it('prefers LEADS_NOTIFY_EMAIL when both are set', async () => {
    process.env.NAUTA_LEADS_NOTIFY_EMAIL = 'anterior@example.test'
    const res = await post(makeSiteEvent())
    expect(res.status).toBe(200)
    expect(sentEmail().to).toBe('ventas@example.test')
  })

  it('skips the email when no recipient is configured, and still returns 200', async () => {
    delete process.env.LEADS_NOTIFY_EMAIL
    const res = await post(makeSiteEvent())
    expect(res.status).toBe(200)
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockCreateLead).toHaveBeenCalled()
  })

  it('links to the canonical CRM host whatever NEXT_PUBLIC_APP_URL says', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://crm.phynd.app'
    try {
      const res = await post(makeSiteEvent())
      expect(res.status).toBe(200)
      expect(sentEmail().html).toContain('https://crm.madfam.io/leads/lead-1')
      expect(sentEmail().html).not.toContain('crm.phynd.app')
    } finally {
      delete process.env.NEXT_PUBLIC_APP_URL
    }
  })

  it('escapes HTML in every sender-controlled value', async () => {
    const event = makeBookingEvent()
    event.payload.lead = {
      email: 'prospecto@example.test',
      name: '<script>alert(1)</script>',
      company: '"><img src=x onerror=alert(2)>',
      phone: '<b>555</b>',
      message: '<img src=x onerror=alert(3)> & más',
    }
    event.payload.context = {
      page: 'https://agenda.example.test/"><script>alert(4)</script>',
      plan_interest: '<i>plan</i>',
    }
    event.payload.attribution = {
      utm_source: '<svg onload=alert(5)>',
      utm_medium: '<u>medio</u>',
      utm_campaign: "'><script>alert(6)</script>",
    }
    event.payload.booking = {
      id: 'bk_123',
      event_type_name: '<script>alert(7)</script>',
      starts_at: '<script>alert(8)</script>',
      timezone: '<script>alert(9)</script>',
      host_name: '<a href="https://attacker.example.test">host</a>',
    }
    const res = await post(event)
    expect(res.status).toBe(200)

    const { html } = sentEmail()
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('<i>')
    expect(html).not.toContain('<u>')
    expect(html).not.toContain('<a href="https://attacker.example.test"')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(2)&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(3)&gt; &amp; más')
    expect(html).toContain('&#39;&gt;&lt;script&gt;alert(6)&lt;/script&gt;')
    // The only links are the ones the template writes itself.
    expect(html.match(/<a /g)).toHaveLength(1)
  })
})

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

// ---------------------------------------------------------------------------
// In-memory stand-in for the database, with the behaviour the route relies on:
//   - `db.transaction(cb)`: rows written through the handle become visible to
//     later deliveries only when `cb` resolves; a throw discards them;
//   - `tx.transaction(cb)`: a savepoint, discarded alone when `cb` throws;
//   - `tx.execute(pg_advisory_xact_lock(key))`: waits while another open
//     transaction holds `key`; released when that transaction ends.
// The mocked services below write through the handle their context carries,
// so what is committed is exactly what a delivery leaves behind.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
type TableName = 'webhook_events' | 'contacts' | 'leads' | 'notes' | 'activities'

function emptyTables(): Record<TableName, Row[]> {
  return { webhook_events: [], contacts: [], leads: [], notes: [], activities: [] }
}

const store = {
  committed: emptyTables(),
  heldLocks: new Map<string, Promise<void>>(),
  /** Every operation in order, e.g. `lock:<key>`, `select:webhook_events`. */
  ops: [] as string[],
  dedupLookups: [] as unknown[],
  transactions: 0,
  rollbacks: 0,
  ids: new Map<string, number>(),
}

function nextId(prefix: string): string {
  const n = (store.ids.get(prefix) ?? 0) + 1
  store.ids.set(prefix, n)
  return `${prefix}-${n}`
}

class FakeTx {
  staged = emptyTables()
  private releases: Array<() => void> = []

  constructor(private readonly parent: FakeTx | null) {}

  private root(): FakeTx {
    return this.parent ? this.parent.root() : this
  }

  rows(table: TableName): Row[] {
    const below = this.parent ? this.parent.rows(table) : store.committed[table]
    return [...below, ...this.staged[table]]
  }

  stage(table: TableName, row: Row): void {
    store.ops.push(`insert:${table}`)
    this.staged[table].push(row)
  }

  mergeInto(target: Record<TableName, Row[]>): void {
    for (const table of Object.keys(this.staged) as TableName[]) {
      target[table].push(...this.staged[table])
    }
  }

  releaseLocks(): void {
    for (const release of this.releases.splice(0)) release()
  }

  execute = vi.fn(async (query: { values: unknown[] }) => {
    const key = String(query.values[0])
    store.ops.push(`lock:${key}`)
    const root = this.root()
    for (;;) {
      const held = store.heldLocks.get(key)
      if (!held) break
      await held
    }
    let release: () => void = () => undefined
    store.heldLocks.set(
      key,
      new Promise<void>((resolve) => {
        release = () => {
          store.heldLocks.delete(key)
          resolve()
        }
      }),
    )
    root.releases.push(release)
  })

  select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn((condition: { __and: [{ __eq: [unknown, string] }, { values: unknown[] }] }) => {
        store.dedupLookups.push(condition)
        store.ops.push('select:webhook_events')
        const provider = condition.__and[0].__eq[1]
        const eventId = condition.__and[1].values[1]
        return {
          limit: vi.fn(async () =>
            this.rows('webhook_events')
              .filter(
                (row) => row.provider === provider && (row.payload as Row).event_id === eventId,
              )
              .map(() => ({ id: 'prior' })),
          ),
        }
      }),
    })),
  }))

  insert = vi.fn(() => ({
    values: vi.fn(async (value: Row) => {
      this.stage('webhook_events', value)
    }),
  }))

  transaction = vi.fn(async (cb: (tx: FakeTx) => Promise<unknown>) => {
    const savepoint = new FakeTx(this)
    const result = await cb(savepoint)
    savepoint.mergeInto(this.staged)
    return result
  })
}

const mockDb = {
  transaction: vi.fn(async (cb: (tx: FakeTx) => Promise<unknown>) => {
    store.transactions += 1
    const tx = new FakeTx(null)
    try {
      const result = await cb(tx)
      tx.mergeInto(store.committed)
      return result
    } catch (error) {
      store.rollbacks += 1
      throw error
    } finally {
      tx.releaseLocks()
    }
  }),
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
    values,
  }),
}))

// Spies record what the route asked for; a rejection makes that write fail.
const mockLookupContact = vi.fn()
const mockCreateContact = vi.fn()
const mockUpdateContact = vi.fn()
const mockGetDefaultPipeline = vi.fn().mockResolvedValue({ id: 'pipeline-1' })
const mockGetStages = vi.fn().mockResolvedValue([{ id: 'stage-1' }, { id: 'stage-2' }])
const mockCreateLead = vi.fn()
const mockCreateNote = vi.fn()
const mockCreateActivity = vi.fn()
const mockSendEmail = vi.fn().mockResolvedValue({ id: 'resend-msg-1' })
const serviceContexts: Array<{ auth: { userId: string } }> = []

type FakeCtx = { db: FakeTx; auth: { userId: string } }

vi.mock('@phynd/services', () => ({
  createServiceContext: (db: unknown, _cache: unknown, auth: { userId: string }) => {
    const ctx = { db, auth }
    serviceContexts.push(ctx)
    return ctx
  },
  withTransaction: (ctx: FakeCtx, tx: FakeTx) => ({ ...ctx, db: tx }),
  ContactsService: vi.fn().mockImplementation((ctx: FakeCtx) => ({
    // Same semantics as the service: lower(email) = lower($1).
    getByEmailIgnoringCase: async (email: string) => {
      mockLookupContact(email)
      store.ops.push('select:contacts')
      return (
        ctx.db
          .rows('contacts')
          .find((row) => String(row.email).toLowerCase() === email.toLowerCase()) ?? null
      )
    },
    create: async (data: Row) => {
      await mockCreateContact(data)
      const row = { id: nextId('contact'), ...data }
      ctx.db.stage('contacts', row)
      return row
    },
    update: mockUpdateContact,
  })),
  LeadsService: vi.fn().mockImplementation((ctx: FakeCtx) => ({
    create: async (data: Row) => {
      await mockCreateLead(data)
      const row = { id: nextId('lead'), ...data }
      ctx.db.stage('leads', row)
      return row
    },
  })),
  PipelinesService: vi.fn().mockImplementation(() => ({
    getDefault: mockGetDefaultPipeline,
    getStages: mockGetStages,
  })),
  NotesService: vi.fn().mockImplementation((ctx: FakeCtx) => ({
    create: async (data: Row) => {
      await mockCreateNote(data)
      const row = { id: nextId('note'), ...data }
      ctx.db.stage('notes', row)
      return row
    },
  })),
  ActivitiesService: vi.fn().mockImplementation((ctx: FakeCtx) => ({
    create: async (data: Row) => {
      const row = { id: nextId('activity'), ...data }
      ctx.db.stage('activities', row)
      // Fails after its insert, like a constraint error on the statement.
      await mockCreateActivity(data)
      return row
    },
  })),
  EmailService: vi.fn().mockImplementation(() => ({
    send: mockSendEmail,
  })),
}))

import { POST } from '../route'

const SECRET = 'DUMMY_LEAD_INTAKE_SECRET_DO_NOT_USE'
const SHARED_EVENTS_SECRET = 'DUMMY_SHARED_EVENTS_SECRET_DO_NOT_USE'
const ORIGINAL_SECRET = process.env.PHYND_CRM_LEAD_INTAKE_SECRET
const ORIGINAL_EVENTS_SECRET = process.env.PHYND_CRM_EVENTS_SECRET
const BOOKING_EVENT_ID = '0b6f6b0e-52a5-4c0c-9a53-6f6f2c1d0001'
const SITE_EVENT_ID = '0b6f6b0e-52a5-4c0c-9a53-6f6f2c1d0002'

function signature(body: string, secret = SECRET): string {
  const ts = Math.floor(Date.now() / 1000)
  const hmac = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
  return `t=${ts},v1=${hmac}`
}

function signedRequest(body: string, headerOverride?: string): Request {
  const header = headerOverride ?? signature(body)
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

/** Rows a delivery left committed. */
function committed(table: TableName): Row[] {
  return store.committed[table]
}

beforeEach(() => {
  process.env.PHYND_CRM_LEAD_INTAKE_SECRET = SECRET
  process.env.PHYND_CRM_EVENTS_SECRET = SHARED_EVENTS_SECRET
  process.env.LEADS_NOTIFY_EMAIL = 'ventas@example.test'
  delete process.env.NAUTA_LEADS_NOTIFY_EMAIL
  store.committed = emptyTables()
  store.heldLocks.clear()
  store.ops = []
  store.dedupLookups = []
  store.transactions = 0
  store.rollbacks = 0
  store.ids.clear()
  serviceContexts.length = 0
  mockCheckRateLimit.mockClear().mockResolvedValue({ allowed: true, remaining: 99 })
  mockDb.transaction.mockClear()
  mockLookupContact.mockReset()
  mockCreateContact.mockReset()
  mockUpdateContact.mockReset()
  mockGetDefaultPipeline.mockClear().mockResolvedValue({ id: 'pipeline-1' })
  mockGetStages.mockClear().mockResolvedValue([{ id: 'stage-1' }, { id: 'stage-2' }])
  mockCreateLead.mockReset()
  mockCreateNote.mockReset()
  mockCreateActivity.mockReset()
  mockSendEmail.mockReset().mockResolvedValue({ id: 'resend-msg-1' })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(() => {
  delete process.env.LEADS_NOTIFY_EMAIL
  delete process.env.NAUTA_LEADS_NOTIFY_EMAIL
  restoreEnv('PHYND_CRM_LEAD_INTAKE_SECRET', ORIGINAL_SECRET)
  restoreEnv('PHYND_CRM_EVENTS_SECRET', ORIGINAL_EVENTS_SECRET)
})

describe('POST /api/webhooks/lead-intake — envelope', () => {
  it('fails closed with 503 when the secret is not configured', async () => {
    delete process.env.PHYND_CRM_LEAD_INTAKE_SECRET
    const res = await post(makeBookingEvent())
    expect(res.status).toBe(503)
    expect(mockCreateContact).not.toHaveBeenCalled()
  })

  it('never falls back to the shared events key', async () => {
    delete process.env.PHYND_CRM_LEAD_INTAKE_SECRET
    const body = JSON.stringify(makeBookingEvent())
    const res = await POST(signedRequest(body, signature(body, SHARED_EVENTS_SECRET)))
    expect(res.status).toBe(503)
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })

  it('rejects a body signed with the shared events key', async () => {
    const body = JSON.stringify(makeBookingEvent())
    const res = await POST(signedRequest(body, signature(body, SHARED_EVENTS_SECRET)))
    expect(res.status).toBe(401)
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })

  it('uses the configured key exactly as set, surrounding spaces included', async () => {
    process.env.PHYND_CRM_LEAD_INTAKE_SECRET = `  ${SECRET}  `
    const body = JSON.stringify(makeBookingEvent())
    const trimmed = await POST(signedRequest(body, signature(body, SECRET)))
    expect(trimmed.status).toBe(401)
    const verbatim = await POST(signedRequest(body, signature(body, `  ${SECRET}  `)))
    expect(verbatim.status).toBe(200)
  })

  it('rejects a bad signature with 401 and touches nothing', async () => {
    const res = await post(makeBookingEvent(), 't=1,v1=deadbeef')
    expect(res.status).toBe(401)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(committed('webhook_events')).toHaveLength(0)
  })

  it('rate limits before reading the body', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 })
    const res = await post(makeBookingEvent())
    expect(res.status).toBe(429)
  })

  it('rejects a declared content-length over 64 KB with 413, before the signature', async () => {
    const req = new Request('http://localhost/api/webhooks/lead-intake', {
      method: 'POST',
      headers: { 'content-length': String(64 * 1024 + 1), 'x-forwarded-for': '10.0.0.1' },
      body: '{}',
    })
    const res = await POST(req)
    expect(res.status).toBe(413)
    expect(mockCheckRateLimit).toHaveBeenCalled()
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })

  it('stops reading a body without content-length once it passes 64 KB', async () => {
    let pulled = 0
    const chunk = new Uint8Array(16 * 1024).fill(0x20)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        if (pulled > 100) controller.close()
        else controller.enqueue(chunk)
      },
    })
    const req = new Request('http://localhost/api/webhooks/lead-intake', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.0.0.1' },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    expect(req.headers.get('content-length')).toBeNull()
    const res = await POST(req)
    expect(res.status).toBe(413)
    // 64 KB is four chunks; the fifth crosses the limit and reading stops.
    expect(pulled).toBeLessThan(10)
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })

  it('accepts a body of exactly 64 KB as far as size goes', async () => {
    const event = makeSiteEvent()
    event.payload.lead.message = ''
    const base = new TextEncoder().encode(JSON.stringify(event)).byteLength
    event.payload.lead.message = 'm'.repeat(64 * 1024 - base)
    const body = JSON.stringify(event)
    expect(new TextEncoder().encode(body).byteLength).toBe(64 * 1024)
    const res = await POST(signedRequest(body))
    expect(res.status).toBe(200)
  })

  it('rejects a schema_version other than "1" with 422, after the signature', async () => {
    for (const schema_version of ['2', 1, undefined]) {
      const res = await post(makeBookingEvent({ schema_version }))
      expect(res.status).toBe(422)
    }
    const unsigned = await post(makeBookingEvent({ schema_version: '2' }), 't=1,v1=deadbeef')
    expect(unsigned.status).toBe(401)
    expect(mockDb.transaction).not.toHaveBeenCalled()
    expect(committed('webhook_events')).toHaveLength(0)
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
    expect(committed('webhook_events')).toHaveLength(0)
  })

  it('rejects a mismatched source and event type with 400', async () => {
    const bookingFromSite = await post(makeBookingEvent({ source: 'madfam-site' }))
    expect(bookingFromSite.status).toBe(400)
    const siteLeadFromKalya = await post(makeSiteEvent({ source: 'kalya' }))
    expect(siteLeadFromKalya.status).toBe(400)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(mockCreateLead).not.toHaveBeenCalled()
    expect(committed('webhook_events')).toHaveLength(0)
  })

  it('deduplicates by event_id per source: a retry is acknowledged and creates nothing', async () => {
    store.committed.webhook_events.push({
      provider: 'kalya',
      payload: { event_id: BOOKING_EVENT_ID },
    })
    const res = await post(makeBookingEvent())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { deduplicated?: boolean }
    expect(body.deduplicated).toBe(true)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(mockCreateLead).not.toHaveBeenCalled()
    expect(mockCreateNote).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(committed('webhook_events')).toHaveLength(1)
    // The lookup is scoped to the sender: the source is the provider.
    expect(JSON.stringify(store.dedupLookups[0])).toContain('"webhook_events.provider","kalya"')
    expect(JSON.stringify(store.dedupLookups[0])).toContain(BOOKING_EVENT_ID)
  })

  it('does not treat the same event_id from the other source as a replay', async () => {
    store.committed.webhook_events.push({
      provider: 'kalya',
      payload: { event_id: SITE_EVENT_ID },
    })
    const res = await post(makeSiteEvent())
    expect(res.status).toBe(200)
    expect((await res.json()) as Row).toEqual({ received: true })
    expect(committed('leads')).toHaveLength(1)
  })

  it('acknowledges and records an unknown event type from a known source', async () => {
    const res = await post(makeBookingEvent({ event_type: 'kalya.booking.rescheduled' }))
    expect(res.status).toBe(200)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(committed('webhook_events')).toHaveLength(1)
    expect(committed('webhook_events')[0]?.provider).toBe('kalya')
    expect(committed('webhook_events')[0]?.eventType).toBe('kalya.booking.rescheduled')
  })

  it('records an unknown event type longer than the column, cut to fit', async () => {
    const eventType = `kalya.${'x'.repeat(200)}`
    const res = await post(makeBookingEvent({ event_type: eventType }))
    expect(res.status).toBe(200)
    expect(committed('webhook_events')[0]?.eventType).toBe(eventType.slice(0, 100))
    const payload = committed('webhook_events')[0]?.payload as { event_type: string }
    expect(payload.event_type).toBe(eventType)
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
        tenant: 'equipo',
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
    expect(origin[1]).toBe('— cuenta de origen (tenant): equipo')
    expect(origin[2]).toContain('— reunión: Diagnóstico de 30 minutos · 17 nov 2026')
    expect(origin[2]).toContain('10:00')
    expect(origin[2]).toContain('(America/Mexico_City) · con Anfitrión Ejemplo')
    expect(origin[3]).toBe('— utm: boletin / email / otono-2026')
    expect(origin).toHaveLength(4)

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const email = sentEmail()
    expect(email.to).toBe('ventas@example.test')
    expect(email.subject).toBe('Nueva reserva en Kalya: Ana Prospecto (Empresa Ejemplo)')
    expect(email.html).toContain('Nuevo lead — reserva en Kalya')
    expect(email.html).toContain('Diagnóstico de 30 minutos')
    expect(email.html).toContain('17 nov 2026')
    expect(email.html).toContain('(America/Mexico_City)')
    expect(email.html).toContain('Anfitrión Ejemplo')
    expect(email.html).toContain('Cuenta de origen (tenant)')
    expect(email.html).toContain('equipo')
    expect(email.html).toContain('boletin')
    expect(email.html).toContain('otono-2026')
    expect(email.html).toContain('Quiero revisar el alcance antes de la llamada.')
    expect(email.html).toContain('https://crm.madfam.io/leads/lead-1')
    expect(email.tags).toEqual([
      { name: 'source', value: 'kalya' },
      { name: 'lead_id', value: 'lead-1' },
      { name: 'contact_id', value: 'contact-1' },
    ])

    expect(committed('webhook_events')).toHaveLength(1)
    expect(committed('webhook_events')[0]?.provider).toBe('kalya')
    expect(committed('webhook_events')[0]?.eventType).toBe('kalya.booking.created')
    expect(serviceContexts[0]?.auth.userId).toBe('service:kalya')
    expect(committed('contacts')).toHaveLength(1)
    expect(committed('leads')).toHaveLength(1)
    expect(committed('notes')).toHaveLength(1)
    expect(committed('activities')).toHaveLength(1)
    expect(store.transactions).toBe(1)
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

  it('still returns 200 when the follow-up task cannot be created: only its savepoint rolls back', async () => {
    mockCreateActivity.mockRejectedValue(new Error('activity insert failed'))
    const res = await post(makeBookingEvent())
    expect(res.status).toBe(200)
    expect(committed('leads')).toHaveLength(1)
    expect(committed('notes')).toHaveLength(1)
    expect(committed('activities')).toHaveLength(0)
    expect(store.rollbacks).toBe(0)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(sentEmail().html).not.toContain('Tarea de seguimiento en el CRM')
    expect(committed('webhook_events')).toHaveLength(1)
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

    expect(committed('webhook_events')[0]?.provider).toBe('madfam-site')
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
    store.committed.contacts.push({
      id: 'contact-existing',
      email: 'prospecto@example.test',
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
    store.committed.contacts.push({ id: 'contact-existing', email: 'prospecto@example.test' })
    const event = makeBookingEvent()
    event.payload.lead.email = 'Prospecto@Example.test'
    const res = await post(event)
    expect(res.status).toBe(200)
    expect(mockLookupContact).toHaveBeenCalledTimes(1)
    expect(mockLookupContact).toHaveBeenCalledWith('prospecto@example.test')
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(committed('leads')[0]?.contactId).toBe('contact-existing')
  })

  it('reuses a contact stored with capitals for the same address in lower case', async () => {
    store.committed.contacts.push({ id: 'contact-ana', email: 'Ana.Perez@Example.com' })
    const event = makeSiteEvent()
    event.payload.lead = { name: 'Ana Pérez', email: 'ana.perez@example.com' }
    const res = await post(event)
    expect(res.status).toBe(200)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(committed('contacts')).toHaveLength(1)
    expect(committed('leads')[0]?.contactId).toBe('contact-ana')
  })

  it('stores a new contact with the address in lower case', async () => {
    const event = makeSiteEvent()
    event.payload.lead.email = '  Nuevo.Contacto@Example.TEST '
    const res = await post(event)
    expect(res.status).toBe(200)
    expect(committed('contacts')[0]?.email).toBe('nuevo.contacto@example.test')
  })

  it('looks up the contact only after taking the event lock and then the email lock', async () => {
    const res = await post(makeBookingEvent())
    expect(res.status).toBe(200)
    const eventLock = store.ops.indexOf(`lock:phynd:lead-intake:event:${BOOKING_EVENT_ID}`)
    const recheck = store.ops.indexOf('select:webhook_events')
    const emailLock = store.ops.indexOf('lock:phynd:lead-intake:email:prospecto@example.test')
    const lookup = store.ops.indexOf('select:contacts')
    expect(eventLock).toBe(0)
    expect(recheck).toBeGreaterThan(eventLock)
    expect(emailLock).toBeGreaterThan(recheck)
    expect(lookup).toBeGreaterThan(emailLock)
    expect(store.ops.at(-1)).toBe('insert:webhook_events')
  })

  it('creates nothing when the lead has no email, and still records the event', async () => {
    const event = makeSiteEvent()
    event.payload.lead = { name: 'Sin Correo', message: 'Hola' }
    const res = await post(event)
    expect(res.status).toBe(200)
    expect(mockLookupContact).not.toHaveBeenCalled()
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(mockCreateLead).not.toHaveBeenCalled()
    expect(mockCreateNote).not.toHaveBeenCalled()
    expect(mockCreateActivity).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(committed('webhook_events')).toHaveLength(1)
  })
})

describe('POST /api/webhooks/lead-intake — notification', () => {
  it('a failed send never bounces the webhook: the lead is already stored', async () => {
    mockSendEmail.mockRejectedValue(new Error('email provider down'))
    const res = await post(makeSiteEvent())
    expect(res.status).toBe(200)
    expect(mockCreateLead).toHaveBeenCalled()
    expect(committed('webhook_events')).toHaveLength(1)
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

describe('POST /api/webhooks/lead-intake — exactly once', () => {
  it('a failure after the lead insert commits nothing and sends nothing; the resend processes once', async () => {
    mockCreateNote.mockRejectedValueOnce(new Error('note insert failed'))
    const first = await post(makeBookingEvent())
    expect(first.status).toBe(500)
    // The lead was written on the transaction, then rolled back with it.
    expect(mockCreateLead).toHaveBeenCalledTimes(1)
    expect(store.rollbacks).toBe(1)
    expect(committed('contacts')).toHaveLength(0)
    expect(committed('leads')).toHaveLength(0)
    expect(committed('notes')).toHaveLength(0)
    expect(committed('activities')).toHaveLength(0)
    expect(committed('webhook_events')).toHaveLength(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(store.heldLocks.size).toBe(0)

    // The sender retries: same event_id, fresh signature.
    const retry = await post(makeBookingEvent())
    expect(retry.status).toBe(200)
    expect((await retry.json()) as Row).toEqual({ received: true })
    expect(committed('contacts')).toHaveLength(1)
    expect(committed('leads')).toHaveLength(1)
    expect(committed('notes')).toHaveLength(1)
    expect(committed('activities')).toHaveLength(1)
    expect(committed('webhook_events')).toHaveLength(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)

    // And a further retry is a replay.
    const replay = await post(makeBookingEvent())
    expect((await replay.json()) as Row).toEqual({ received: true, deduplicated: true })
    expect(committed('leads')).toHaveLength(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('a failure recording the event rolls back the lead as well', async () => {
    const original = FakeTx.prototype.stage
    const spy = vi.spyOn(FakeTx.prototype, 'stage').mockImplementation(function (
      this: FakeTx,
      table: TableName,
      row: Row,
    ) {
      if (table === 'webhook_events') throw new Error('webhook_events insert failed')
      return original.call(this, table, row)
    })
    try {
      const res = await post(makeSiteEvent())
      expect(res.status).toBe(500)
    } finally {
      spy.mockRestore()
    }
    expect(committed('leads')).toHaveLength(0)
    expect(committed('contacts')).toHaveLength(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('the re-check inside the lock stops a delivery that lost the race', async () => {
    // Nothing is recorded yet when the second delivery starts, so only the
    // check made after the event lock can see the first delivery's commit.
    const [a, b] = await Promise.all([post(makeBookingEvent()), post(makeBookingEvent())])
    const bodies = [(await a.json()) as Row, (await b.json()) as Row]
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(bodies).toContainEqual({ received: true })
    expect(bodies).toContainEqual({ received: true, deduplicated: true })
    expect(store.transactions).toBe(2)
    expect(committed('contacts')).toHaveLength(1)
    expect(committed('leads')).toHaveLength(1)
    expect(committed('notes')).toHaveLength(1)
    expect(committed('activities')).toHaveLength(1)
    expect(committed('webhook_events')).toHaveLength(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('two first deliveries for one new address (different events) share one contact', async () => {
    const other = makeBookingEvent({ event_id: '0b6f6b0e-52a5-4c0c-9a53-6f6f2c1d0009' })
    other.payload.lead.email = 'PROSPECTO@example.test'
    const [a, b] = await Promise.all([post(makeBookingEvent()), post(other)])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(committed('contacts')).toHaveLength(1)
    expect(committed('leads')).toHaveLength(2)
    expect(new Set(committed('leads').map((lead) => lead.contactId)).size).toBe(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
  })

  it('a replay writes and sends nothing', async () => {
    await post(makeSiteEvent())
    const before = JSON.stringify(store.committed)
    mockSendEmail.mockClear()
    const replay = await post(makeSiteEvent())
    expect((await replay.json()) as Row).toEqual({ received: true, deduplicated: true })
    expect(JSON.stringify(store.committed)).toBe(before)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/lead-intake — field limits', () => {
  it('cuts name and company to 255 characters, counting characters not UTF-16 units', async () => {
    const event = makeSiteEvent()
    event.payload.lead.name = `${'ñ'.repeat(250)}${'😀'.repeat(20)}`
    event.payload.lead.company = 'c'.repeat(400)
    const res = await post(event)
    expect(res.status).toBe(200)
    const contact = committed('contacts')[0] as { name: string; company: string }
    expect(Array.from(contact.name)).toHaveLength(255)
    expect(contact.name.endsWith('😀'.repeat(5))).toBe(true)
    expect(contact.company).toBe('c'.repeat(255))
    const task = committed('activities')[0] as { title: string }
    expect(Array.from(task.title)).toHaveLength(255)
    expect(task.title.startsWith('Dar seguimiento: ')).toBe(true)
  })

  it('keeps a phone of up to 50 characters on the contact', async () => {
    const event = makeBookingEvent()
    event.payload.lead.phone = '5'.repeat(50)
    const res = await post(event)
    expect(res.status).toBe(200)
    expect(committed('contacts')[0]?.phone).toBe('5'.repeat(50))
    expect(String(committed('notes')[0]?.content)).not.toContain('teléfono')
  })

  it('puts a phone longer than 50 characters in the note, capped at 200, not on the contact', async () => {
    const event = makeBookingEvent()
    event.payload.lead.phone = `+52 ${'9'.repeat(300)}`
    const res = await post(event)
    expect(res.status).toBe(200)
    expect(committed('contacts')[0]?.phone).toBeUndefined()
    const lines = String(committed('notes')[0]?.content).split('\n')
    const phoneLine = lines.find((line) => line.startsWith('— teléfono (no cabe en el contacto): '))
    expect(phoneLine).toBe(
      `— teléfono (no cabe en el contacto): ${`+52 ${'9'.repeat(300)}`.slice(0, 200)}`,
    )
    expect(committed('leads')).toHaveLength(1)
  })

  it('rejects an address longer than 255 characters with 422 and records nothing', async () => {
    const event = makeSiteEvent()
    event.payload.lead.email = `${'a'.repeat(244)}@example.test`
    expect(event.payload.lead.email).toHaveLength(257)
    const res = await post(event)
    expect(res.status).toBe(422)
    expect(mockDb.transaction).not.toHaveBeenCalled()
    expect(committed('webhook_events')).toHaveLength(0)
  })

  it('accepts an address of exactly 255 characters', async () => {
    const event = makeSiteEvent()
    event.payload.lead.email = `${'a'.repeat(242)}@example.test`
    expect(event.payload.lead.email).toHaveLength(255)
    const res = await post(event)
    expect(res.status).toBe(200)
  })

  it('rejects a value that is not an address with 422', async () => {
    for (const email of ['not-an-email', 'a@b', 'two words@example.test', 'x@@example.test']) {
      const event = makeSiteEvent()
      event.payload.lead.email = email
      expect((await post(event)).status).toBe(422)
    }
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })

  it('does not validate the lead of an event type it only records', async () => {
    const event = makeBookingEvent({ event_type: 'kalya.booking.rescheduled' })
    event.payload.lead.email = 'not-an-email'
    const res = await post(event)
    expect(res.status).toBe(200)
    expect(committed('webhook_events')).toHaveLength(1)
  })

  it('caps a long tenant like the other attribution values', async () => {
    const event = makeBookingEvent()
    event.payload.context = { tenant: 't'.repeat(400) }
    const res = await post(event)
    expect(res.status).toBe(200)
    const attribution = committed('leads')[0]?.attribution as Record<string, string>
    expect(attribution.tenant).toBe('t'.repeat(255))
  })
})

describe('POST /api/webhooks/lead-intake — tenant and page', () => {
  it('takes the tenant from the context only, never from the attribution block', async () => {
    const event = makeSiteEvent()
    event.payload.context = { page: '/contacto' }
    event.payload.attribution = { utm_source: 'buscador', tenant: 'spoofed' }
    const res = await post(event)
    expect(res.status).toBe(200)
    const attribution = committed('leads')[0]?.attribution as Record<string, string>
    expect(attribution.tenant).toBeUndefined()
    expect(String(committed('notes')[0]?.content)).not.toContain('tenant')
  })

  it('shows a page path as it was sent', async () => {
    const event = makeSiteEvent()
    event.payload.context = { page: '/es/contacto?plan=pro' }
    const res = await post(event)
    expect(res.status).toBe(200)
    expect(String(committed('notes')[0]?.content).split('\n')[2]).toBe(
      '— vía formulario del sitio · /es/contacto?plan=pro',
    )
    expect(sentEmail().html).toContain('Vía /es/contacto?plan=pro')
  })

  it('renders a page that is not a URL as escaped text, never as a link', async () => {
    const event = makeSiteEvent()
    event.payload.context = { page: 'javascript:alert(1)//"><b>x</b>' }
    const res = await post(event)
    expect(res.status).toBe(200)
    const { html } = sentEmail()
    expect(html).toContain('Vía javascript:alert(1)//&quot;&gt;&lt;b&gt;x&lt;/b&gt;')
    expect(html).not.toContain('href="javascript')
    expect(html.match(/<a /g)).toHaveLength(1)
  })
})

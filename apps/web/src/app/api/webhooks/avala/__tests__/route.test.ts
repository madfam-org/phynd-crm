import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

// Unit-tested on their own in lib/webhooks/__tests__ (first-contact,
// avala-lead-deletion, lead-intake); here only the wiring is checked.
const mockResolveOwner = vi.fn().mockResolvedValue(null)
const mockOpenFirstContact = vi.fn().mockResolvedValue(new Date('2026-05-27T15:00:00.000Z'))
vi.mock('@/lib/webhooks/first-contact', () => ({
  resolveIntakeLeadOwner: (...args: unknown[]) => mockResolveOwner(...args),
  openFirstContactTask: (...args: unknown[]) => mockOpenFirstContact(...args),
}))

const mockNotifyNewLead = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/webhooks/lead-intake', () => ({
  notifyNewLead: (...args: unknown[]) => mockNotifyNewLead(...args),
}))

const mockPropagateDeletion = vi.fn().mockResolvedValue({
  leadsDeleted: 1,
  contactsDeleted: 1,
  contactsKept: 0,
  notesDeleted: 1,
  tasksDeleted: 1,
  eventsRedacted: 1,
})
const mockCreateDeletionStore = vi.fn((ctx: unknown) => ({ ctx }))
vi.mock('@/lib/webhooks/avala-lead-deletion', () => ({
  propagateAvalaLeadDeletion: (...args: unknown[]) => mockPropagateDeletion(...args),
  createAvalaLeadDeletionStore: (ctx: unknown) => mockCreateDeletionStore(ctx),
}))

const state = {
  insertedWebhookEvents: [] as Array<Record<string, unknown>>,
}

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined)
const mockUpdateSet = vi.fn(() => ({
  where: mockUpdateWhere,
}))

/** Result of each `select … limit 1`: the dedup check, then the deleted-lead check. */
const mockSelectLimit = vi.fn().mockResolvedValue([])
const mockTx = { tx: true }

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: mockSelectLimit,
      })),
    })),
  })),
  transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockTx)),
  insert: vi.fn(() => ({
    values: vi.fn((value: Record<string, unknown>) => {
      state.insertedWebhookEvents.push(value)
      return Promise.resolve()
    }),
  })),
  update: vi.fn(() => ({
    set: mockUpdateSet,
  })),
}

vi.mock('@phynd/db', () => ({
  getDb: () => mockDb,
}))

vi.mock('@phynd/db/schema', () => ({
  contacts: { id: 'contacts.id', externalJanuaId: 'contacts.external_janua_id' },
  conversions: { type: 'conversions.type', leadId: 'conversions.lead_id' },
  webhookEvents: {
    id: 'webhook_events.id',
    provider: 'webhook_events.provider',
    eventType: 'webhook_events.event_type',
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

const mockContact = { id: 'contact-1', email: 'lead@example.com', externalJanuaId: null }
const mockLead = { id: 'lead-1', attribution: { landing_page: '/contacto' } }
const mockVisitorSession = { id: 'visitor-session-1' }

const mockGetByEmail = vi.fn().mockResolvedValue(null)
const mockCreateContact = vi.fn().mockResolvedValue(mockContact)
const mockGetDefaultPipeline = vi.fn().mockResolvedValue({ id: 'pipeline-1' })
const mockGetStages = vi.fn().mockResolvedValue([{ id: 'stage-1' }])
const mockCreateLead = vi.fn().mockResolvedValue(mockLead)
const mockRecordConversion = vi.fn().mockResolvedValue({ id: 'conversion-1' })
const mockUpsertSession = vi.fn().mockResolvedValue(mockVisitorSession)
const mockCreateNote = vi.fn().mockResolvedValue({ id: 'note-1' })
const mockRecordPageView = vi.fn().mockResolvedValue({ id: 'page-view-1' })

vi.mock('@phynd/services', () => ({
  createServiceContext: (db: unknown) => ({ db }),
  withTransaction: (ctx: Record<string, unknown>, tx: unknown) => ({ ...ctx, db: tx }),
  NotesService: vi.fn().mockImplementation(() => ({
    create: mockCreateNote,
  })),
  ContactsService: vi.fn().mockImplementation(() => ({
    getByEmail: mockGetByEmail,
    create: mockCreateContact,
  })),
  LeadsService: vi.fn().mockImplementation(() => ({
    create: mockCreateLead,
  })),
  PipelinesService: vi.fn().mockImplementation(() => ({
    getDefault: mockGetDefaultPipeline,
    getStages: mockGetStages,
  })),
  ConversionsService: vi.fn().mockImplementation(() => ({
    recordConversion: mockRecordConversion,
  })),
  VisitorTrackingService: vi.fn().mockImplementation(() => ({
    upsertFromWebhook: mockUpsertSession,
    recordPageView: mockRecordPageView,
  })),
}))

import { POST } from '../route'

const SECRET = 'DUMMY_WEBHOOK_SECRET_DO_NOT_USE'
const ORIGINAL_SECRET = process.env.PHYND_CRM_EVENTS_SECRET

function signedRequest(body: string, headerOverride?: string): Request {
  const ts = Math.floor(Date.now() / 1000)
  const hmac = crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex')
  const header = headerOverride ?? `t=${ts},v1=${hmac}`
  return new Request('http://localhost/api/webhooks/avala', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-madfam-signature': header,
      'x-forwarded-for': '10.0.0.1',
    },
    body,
  })
}

function makeLeadEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schema_version: '1',
    event_id: 'avala:lead.captured:lead:lead-1:v1',
    event_type: 'avala.lead.captured',
    source: 'avala',
    occurred_at: '2026-05-26T12:00:00.000Z',
    aggregate: { type: 'lead', id: 'lead-1' },
    payload: {
      lead: {
        id: 'lead-1',
        email: 'lead@example.com',
        name: 'Lead Example',
        source: 'marketing_contact',
        leadType: 'ORGANIZATION',
        message: 'Queremos certificar a nuestro equipo.',
        interests: ['demo'],
      },
      attribution: {
        sessionId: 'avala-session-1',
        sourcePage: '/contacto',
        intent: 'sales-request',
        utmSource: 'boletin',
      },
      consent: { commercialContact: true },
    },
    ...overrides,
  }
}

beforeEach(() => {
  process.env.PHYND_CRM_EVENTS_SECRET = SECRET
  state.insertedWebhookEvents = []
  mockCheckRateLimit.mockClear().mockResolvedValue({ allowed: true, remaining: 99 })
  mockDb.select.mockClear()
  mockDb.insert.mockClear()
  mockDb.update.mockClear()
  mockUpdateSet.mockClear()
  mockUpdateWhere.mockClear()
  mockGetByEmail.mockClear().mockResolvedValue(null)
  mockCreateContact.mockClear().mockResolvedValue(mockContact)
  mockGetDefaultPipeline.mockClear().mockResolvedValue({ id: 'pipeline-1' })
  mockGetStages.mockClear().mockResolvedValue([{ id: 'stage-1' }])
  mockCreateLead.mockClear().mockResolvedValue(mockLead)
  mockRecordConversion.mockClear().mockResolvedValue({ id: 'conversion-1' })
  mockUpsertSession.mockClear().mockResolvedValue(mockVisitorSession)
  mockRecordPageView.mockClear().mockResolvedValue({ id: 'page-view-1' })
  mockCreateNote.mockClear().mockResolvedValue({ id: 'note-1' })
  mockSelectLimit.mockReset().mockResolvedValue([])
  mockDb.transaction.mockClear()
  mockResolveOwner.mockClear().mockResolvedValue(null)
  mockOpenFirstContact.mockClear().mockResolvedValue(new Date('2026-05-27T15:00:00.000Z'))
  mockNotifyNewLead.mockClear().mockResolvedValue(undefined)
  mockPropagateDeletion.mockClear()
  mockCreateDeletionStore.mockClear()
})

afterEach(() => {
  process.env.PHYND_CRM_EVENTS_SECRET = ORIGINAL_SECRET
})

describe('POST /api/webhooks/avala', () => {
  it('returns 503 when PHYND_CRM_EVENTS_SECRET is unset', async () => {
    delete process.env.PHYND_CRM_EVENTS_SECRET
    const res = await POST(signedRequest(JSON.stringify(makeLeadEvent())))
    expect(res.status).toBe(503)
  })

  it('returns 401 when the signature is invalid', async () => {
    const res = await POST(signedRequest(JSON.stringify(makeLeadEvent()), 't=1,v1=bad'))
    expect(res.status).toBe(401)
  })

  it('captures Avala lead events as contact, lead, visitor session, conversion, and webhook audit', async () => {
    const res = await POST(signedRequest(JSON.stringify(makeLeadEvent())))

    expect(res.status).toBe(200)
    const json = (await res.json()) as { received: boolean; status: string }
    expect(json).toMatchObject({ received: true, status: 'processed' })
    expect(mockCreateContact).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'lead@example.com', name: 'Lead Example' }),
    )
    expect(mockCreateLead).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'contact-1', source: 'marketing_contact' }),
    )
    expect(mockUpsertSession).toHaveBeenCalledWith(
      expect.objectContaining({ externalSessionId: 'avala-session-1', contactId: 'contact-1' }),
    )
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'contact-1',
        metadata: expect.objectContaining({
          event_id: 'avala:lead.captured:lead:lead-1:v1',
          source: 'avala',
        }),
        visitorSessionId: 'visitor-session-1',
      }),
    )
    expect(mockRecordConversion).not.toHaveBeenCalled()
    expect(state.insertedWebhookEvents).toHaveLength(1)
    expect(state.insertedWebhookEvents[0]).toMatchObject({
      provider: 'avala',
      eventType: 'avala.lead.captured',
    })
  })

  it('keeps the message, lead type and context: attribution on the lead, a note on the lead', async () => {
    const res = await POST(signedRequest(JSON.stringify(makeLeadEvent())))
    expect(res.status).toBe(200)

    expect(mockCreateLead).toHaveBeenCalledWith(
      expect.objectContaining({
        attribution: {
          utm_source: 'boletin',
          landing_page: '/contacto',
          lead_type: 'ORGANIZATION',
        },
      }),
    )
    expect(mockCreateNote).toHaveBeenCalledTimes(1)
    const note = mockCreateNote.mock.calls[0]?.[0] as {
      content: string
      entityType: string
      entityId: string
    }
    expect(note.entityType).toBe('lead')
    expect(note.entityId).toBe('lead-1')
    expect(note.content.split('\n')[0]).toBe('Queremos certificar a nuestro equipo.')
    expect(note.content).toContain('— tipo de lead: ORGANIZATION')
    expect(note.content).toContain('— intención: sales-request')
  })

  it('gives the lead an owner, opens its first-contact task and sends the notification', async () => {
    mockResolveOwner.mockResolvedValue('user-default')
    const res = await POST(signedRequest(JSON.stringify(makeLeadEvent())))
    expect(res.status).toBe(200)

    expect(mockResolveOwner).toHaveBeenCalledWith(mockDb, expect.anything(), {
      contactOwnerId: undefined,
      source: 'avala',
      contactId: 'contact-1',
    })
    expect(mockCreateLead).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'user-default' }),
    )
    expect(mockOpenFirstContact).toHaveBeenCalledTimes(1)
    expect(mockOpenFirstContact.mock.calls[0]?.[2]).toMatchObject({
      leadId: 'lead-1',
      ownerId: 'user-default',
      subject: 'Lead Example',
    })
    expect(mockNotifyNewLead).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'avala',
        leadId: 'lead-1',
        contactId: 'contact-1',
        message: 'Queremos certificar a nuestro equipo.',
        leadType: 'ORGANIZATION',
        followUpDueAt: new Date('2026-05-27T15:00:00.000Z'),
      }),
    )
  })

  it('creates nothing new on a redelivery of the same event', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ id: 'prior' }])
    const res = await POST(signedRequest(JSON.stringify(makeLeadEvent())))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status: string }).status).toBe('duplicate')
    expect(mockCreateLead).not.toHaveBeenCalled()
    expect(mockCreateNote).not.toHaveBeenCalled()
    expect(mockOpenFirstContact).not.toHaveBeenCalled()
    expect(mockNotifyNewLead).not.toHaveBeenCalled()
  })

  it('marks a waitlist entry as not a sales target in its task', async () => {
    const event = makeLeadEvent()
    const lead = (event.payload as { lead: Record<string, unknown> }).lead
    lead.source = 'ec_waitlist'
    lead.ecCode = 'EC0000'
    delete lead.message
    await POST(signedRequest(JSON.stringify(event)))
    const task = mockOpenFirstContact.mock.calls[0]?.[2] as { description: string }
    expect(task.description).toContain('Estándar: EC0000.')
    expect(task.description).toContain('no es un prospecto de venta')
  })

  it('ignores a replayed capture of a lead Avala already deleted', async () => {
    // not seen as this event, but an avala.lead.deleted for the lead exists
    mockSelectLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'deleted' }])
    const res = await POST(signedRequest(JSON.stringify(makeLeadEvent())))
    expect(res.status).toBe(200)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(mockCreateLead).not.toHaveBeenCalled()
    expect(state.insertedWebhookEvents).toHaveLength(1)
  })

  it('propagates avala.lead.deleted in one transaction, by the Avala lead id', async () => {
    const event = {
      schema_version: '1',
      event_id: 'avala:lead.deleted:lead:lead-1:v1',
      event_type: 'avala.lead.deleted',
      source: 'avala',
      occurred_at: '2026-06-01T12:00:00.000Z',
      aggregate: { type: 'lead', id: 'lead-1' },
      payload: { lead: { id: 'lead-1' } },
    }
    const res = await POST(signedRequest(JSON.stringify(event)))
    expect(res.status).toBe(200)
    expect(mockDb.transaction).toHaveBeenCalledTimes(1)
    expect(mockCreateDeletionStore).toHaveBeenCalledWith(expect.objectContaining({ db: mockTx }))
    expect(mockPropagateDeletion).toHaveBeenCalledWith(expect.anything(), 'lead-1')
    expect(state.insertedWebhookEvents[0]).toMatchObject({
      provider: 'avala',
      eventType: 'avala.lead.deleted',
    })
  })

  it('falls back to the aggregate id and ignores a deletion with no lead id', async () => {
    const base = {
      schema_version: '1',
      event_type: 'avala.lead.deleted',
      source: 'avala',
      occurred_at: '2026-06-01T12:00:00.000Z',
      payload: {},
    }
    await POST(
      signedRequest(
        JSON.stringify({ ...base, event_id: 'e-1', aggregate: { type: 'lead', id: 'lead-9' } }),
      ),
    )
    expect(mockPropagateDeletion).toHaveBeenLastCalledWith(expect.anything(), 'lead-9')

    mockPropagateDeletion.mockClear()
    const res = await POST(signedRequest(JSON.stringify({ ...base, event_id: 'e-2' })))
    expect(res.status).toBe(200)
    expect(mockPropagateDeletion).not.toHaveBeenCalled()
  })

  it('answers 500 and records nothing when the deletion fails, so Avala retries', async () => {
    mockPropagateDeletion.mockRejectedValueOnce(new Error('db down'))
    const res = await POST(
      signedRequest(
        JSON.stringify({
          schema_version: '1',
          event_id: 'e-3',
          event_type: 'avala.lead.deleted',
          source: 'avala',
          occurred_at: '2026-06-01T12:00:00.000Z',
          payload: { lead: { id: 'lead-1' } },
        }),
      ),
    )
    expect(res.status).toBe(500)
    expect(state.insertedWebhookEvents).toHaveLength(0)
  })
})

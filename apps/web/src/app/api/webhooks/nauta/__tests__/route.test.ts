import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Scaffolding cloned from the avala webhook tests one directory over — same
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
}

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(state.seenEventIds.length > 0 ? [{ id: 'prior' }] : []),
          ),
      })),
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

const mockContact = { id: 'contact-1', email: 'prospect@clinica.mx', externalJanuaId: null }
const mockLead = { id: 'lead-1' }

const mockGetByEmail = vi.fn().mockResolvedValue(null)
const mockCreateContact = vi.fn().mockResolvedValue(mockContact)
const mockGetDefaultPipeline = vi.fn().mockResolvedValue({ id: 'pipeline-1' })
const mockGetStages = vi.fn().mockResolvedValue([{ id: 'stage-1' }])
const mockCreateLead = vi.fn().mockResolvedValue(mockLead)
const mockCreateNote = vi.fn().mockResolvedValue({ id: 'note-1' })

vi.mock('@phynd/services', () => ({
  createServiceContext: (db: unknown) => ({ db }),
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
  NotesService: vi.fn().mockImplementation(() => ({
    create: mockCreateNote,
  })),
}))

import { POST } from '../route'

const SECRET = 'DUMMY_WEBHOOK_SECRET_DO_NOT_USE'
const ORIGINAL_SECRET = process.env.PHYND_CRM_EVENTS_SECRET

function signedRequest(body: string, headerOverride?: string): Request {
  const ts = Math.floor(Date.now() / 1000)
  const hmac = crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex')
  const header = headerOverride ?? `t=${ts},v1=${hmac}`
  return new Request('http://localhost/api/webhooks/nauta', {
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
    event_id: 'f4d0a35e-7c56-4e6e-9b1f-9a29d9b40001',
    event_type: 'nauta.lead.captured',
    source: 'nauta',
    occurred_at: '2026-08-12T06:00:00.000Z',
    payload: {
      lead: {
        email: 'prospect@clinica.mx',
        name: 'Dra. Prospecto',
        company: 'Clínica Ejemplo',
        phone: '+52 777 000 0000',
        message: 'Nos interesa el plan Ecosistema para 60 familias.',
      },
      context: {
        page: 'https://nauta.madfam.io/',
        plan_interest: 'ecosistema',
      },
    },
    ...overrides,
  }
}

beforeEach(() => {
  process.env.PHYND_CRM_EVENTS_SECRET = SECRET
  state.insertedWebhookEvents = []
  state.seenEventIds = []
  mockCheckRateLimit.mockClear().mockResolvedValue({ allowed: true, remaining: 99 })
  mockDb.select.mockClear()
  mockDb.insert.mockClear()
  mockGetByEmail.mockClear().mockResolvedValue(null)
  mockCreateContact.mockClear().mockResolvedValue(mockContact)
  mockGetDefaultPipeline.mockClear().mockResolvedValue({ id: 'pipeline-1' })
  mockGetStages.mockClear().mockResolvedValue([{ id: 'stage-1' }])
  mockCreateLead.mockClear().mockResolvedValue(mockLead)
  mockCreateNote.mockClear().mockResolvedValue({ id: 'note-1' })
})

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.PHYND_CRM_EVENTS_SECRET
  } else {
    process.env.PHYND_CRM_EVENTS_SECRET = ORIGINAL_SECRET
  }
})

describe('POST /api/webhooks/nauta', () => {
  it('fails closed with 503 when the secret is not configured', async () => {
    delete process.env.PHYND_CRM_EVENTS_SECRET
    const res = await POST(signedRequest(JSON.stringify(makeLeadEvent())))
    expect(res.status).toBe(503)
  })

  it('rejects a bad signature with 401 and touches nothing', async () => {
    const res = await POST(signedRequest(JSON.stringify(makeLeadEvent()), 't=1,v1=deadbeef'))
    expect(res.status).toBe(401)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(state.insertedWebhookEvents).toHaveLength(0)
  })

  it('rejects a non-nauta source with 400', async () => {
    const res = await POST(
      signedRequest(JSON.stringify(makeLeadEvent({ source: 'avala' }))),
    )
    expect(res.status).toBe(400)
    expect(mockCreateContact).not.toHaveBeenCalled()
  })

  it('creates contact + lead in the default pipeline and a note with the message', async () => {
    const res = await POST(signedRequest(JSON.stringify(makeLeadEvent())))
    expect(res.status).toBe(200)

    expect(mockCreateContact).toHaveBeenCalledWith({
      name: 'Dra. Prospecto',
      email: 'prospect@clinica.mx',
      phone: '+52 777 000 0000',
      company: 'Clínica Ejemplo',
    })
    expect(mockCreateLead).toHaveBeenCalledWith({
      contactId: 'contact-1',
      source: 'nauta',
      pipelineId: 'pipeline-1',
      stageId: 'stage-1',
    })
    // The prospect's own words must land on the record — the whole point of
    // relaying the message instead of just the identity fields.
    expect(mockCreateNote).toHaveBeenCalledTimes(1)
    const note = mockCreateNote.mock.calls[0]?.[0] as { content: string; entityId: string }
    expect(note.entityId).toBe('contact-1')
    expect(note.content).toContain('plan Ecosistema para 60 familias')
    expect(note.content).toContain('interés: ecosistema')

    expect(state.insertedWebhookEvents).toHaveLength(1)
    expect(state.insertedWebhookEvents[0]?.provider).toBe('nauta')
  })

  it('reuses an existing contact instead of duplicating it', async () => {
    mockGetByEmail.mockResolvedValue(mockContact)
    const res = await POST(signedRequest(JSON.stringify(makeLeadEvent())))
    expect(res.status).toBe(200)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(mockCreateLead).toHaveBeenCalled()
  })

  it('deduplicates by event_id: a replay is acknowledged and processes nothing', async () => {
    state.seenEventIds = ['f4d0a35e-7c56-4e6e-9b1f-9a29d9b40001']
    const res = await POST(signedRequest(JSON.stringify(makeLeadEvent())))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { deduplicated?: boolean }
    expect(body.deduplicated).toBe(true)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(state.insertedWebhookEvents).toHaveLength(0)
  })

  it('drops a lead without an email silently (malformed relay, not a prospect)', async () => {
    const event = makeLeadEvent()
    ;(event.payload as { lead: Record<string, unknown> }).lead = { name: 'No Email' }
    const res = await POST(signedRequest(JSON.stringify(event)))
    expect(res.status).toBe(200)
    expect(mockCreateContact).not.toHaveBeenCalled()
    // Still recorded for the audit trail.
    expect(state.insertedWebhookEvents).toHaveLength(1)
  })

  it('acknowledges an unknown nauta event type without failing the sender', async () => {
    const res = await POST(
      signedRequest(JSON.stringify(makeLeadEvent({ event_type: 'nauta.future.thing' }))),
    )
    expect(res.status).toBe(200)
    expect(mockCreateContact).not.toHaveBeenCalled()
    expect(state.insertedWebhookEvents).toHaveLength(1)
  })

  it('rate limits before reading the body', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 })
    const res = await POST(signedRequest(JSON.stringify(makeLeadEvent())))
    expect(res.status).toBe(429)
  })
})

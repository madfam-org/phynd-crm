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

const state = {
  insertedWebhookEvents: [] as Array<Record<string, unknown>>,
}

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined)
const mockUpdateSet = vi.fn(() => ({
  where: mockUpdateWhere,
}))

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue([]),
      })),
    })),
  })),
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
const mockLead = { id: 'lead-1' }
const mockVisitorSession = { id: 'visitor-session-1' }

const mockGetByEmail = vi.fn().mockResolvedValue(null)
const mockCreateContact = vi.fn().mockResolvedValue(mockContact)
const mockGetDefaultPipeline = vi.fn().mockResolvedValue({ id: 'pipeline-1' })
const mockGetStages = vi.fn().mockResolvedValue([{ id: 'stage-1' }])
const mockCreateLead = vi.fn().mockResolvedValue(mockLead)
const mockRecordConversion = vi.fn().mockResolvedValue({ id: 'conversion-1' })
const mockUpsertSession = vi.fn().mockResolvedValue(mockVisitorSession)
const mockRecordPageView = vi.fn().mockResolvedValue({ id: 'page-view-1' })

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
        interests: ['demo'],
      },
      attribution: {
        sessionId: 'avala-session-1',
        sourcePage: '/contacto',
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
})

import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock modules (declared before route import). We sign bodies for real via the
// shared madfam-signature format, so the signature path is exercised end-to-end.
// ---------------------------------------------------------------------------

const state = {
  selectRows: [] as Array<Record<string, unknown>>,
}

const selectChain = {
  from: vi.fn(() => selectChain),
  where: vi.fn(() => selectChain),
  orderBy: vi.fn(() => selectChain),
  limit: vi.fn(async () => state.selectRows),
}

const mockDb = {
  select: vi.fn(() => selectChain),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(async () => [{ id: 'gen-id' }]),
    })),
  })),
  transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockDb)),
}

vi.mock('@phynd/db', () => ({
  getDb: () => mockDb,
  conversions: { id: 'conversions.id' },
  contacts: { id: 'contacts.id', externalJanuaId: 'contacts.external_janua_id' },
  campaigns: { id: 'campaigns.id', utmCampaign: 'campaigns.utm_campaign', createdAt: 'campaigns.created_at' },
  webhookEvents: {
    id: 'webhook_events.id',
    provider: 'webhook_events.provider',
    payload: 'webhook_events.payload',
  },
}))

vi.mock('@phynd/logging', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ __and: args }),
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sql: String.raw({ raw: strings }, ...values.map((v) => String(v))),
  }),
}))

import { POST } from '../route'

const SECRET = 'DUMMY_WEBHOOK_SECRET_DO_NOT_USE'
const ORIGINAL = process.env.PHYND_CRM_EVENTS_SECRET

function signedRequest(body: string, headerOverride?: string): Request {
  const ts = Math.floor(Date.now() / 1000)
  const hmac = crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex')
  const header = headerOverride ?? `t=${ts},v1=${hmac}`
  return new Request('http://localhost/api/v1/events/trip.attributed', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-madfam-signature': header },
    body,
  })
}

function makeEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schema_version: '1',
    event_id: 'trip_evt_1',
    provider: 'routecraft',
    trip_id: 'trip_abc',
    trip_name: 'CDMX Q3 sourcing',
    cities: ['Mexico City', 'Guadalajara'],
    total_score: 87,
    business_score: 91,
    pipeline_value: 12000,
    deals_created: ['deal_1'],
    meetings_held: 3,
    attribution: { source_agent_id: 'agent_7', campaign_id: 'camp_spring' },
    occurred_at: '2026-07-08T12:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  process.env.PHYND_CRM_EVENTS_SECRET = SECRET
  state.selectRows = []
  mockDb.select.mockClear()
  mockDb.insert.mockClear()
  mockDb.transaction.mockClear()
})

afterEach(() => {
  process.env.PHYND_CRM_EVENTS_SECRET = ORIGINAL
})

describe('POST /api/v1/events/trip.attributed', () => {
  it('returns 503 when PHYND_CRM_EVENTS_SECRET is unset', async () => {
    delete process.env.PHYND_CRM_EVENTS_SECRET
    const res = await POST(signedRequest(JSON.stringify(makeEvent())))
    expect(res.status).toBe(503)
  })

  it('returns 401 when the signature is missing', async () => {
    const req = new Request('http://localhost/api/v1/events/trip.attributed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeEvent()),
    })
    expect((await POST(req)).status).toBe(401)
  })

  it('returns 401 when the signature is wrong', async () => {
    const ts = Math.floor(Date.now() / 1000)
    const bogus = `t=${ts},v1=${'0'.repeat(64)}`
    expect((await POST(signedRequest(JSON.stringify(makeEvent()), bogus))).status).toBe(401)
  })

  it('returns 400 on malformed JSON', async () => {
    expect((await POST(signedRequest('not json'))).status).toBe(400)
  })

  it('returns 400 when a required field is missing', async () => {
    const res = await POST(signedRequest(JSON.stringify(makeEvent({ trip_id: '' }))))
    expect(res.status).toBe(400)
  })

  it('returns 400 when pipeline_value is negative', async () => {
    const res = await POST(signedRequest(JSON.stringify(makeEvent({ pipeline_value: -1 }))))
    expect(res.status).toBe(400)
  })

  it('returns 201 and records a trip_attributed conversion on the happy path', async () => {
    const res = await POST(signedRequest(JSON.stringify(makeEvent())))
    expect(res.status).toBe(201)
    const json = (await res.json()) as { received: boolean; conversion_id: string | null }
    expect(json.received).toBe(true)
    expect(mockDb.transaction).toHaveBeenCalled()
    // The conversion row is inserted with type 'trip_attributed'.
    const insertCalls = mockDb.insert.mock.calls.length
    expect(insertCalls).toBeGreaterThanOrEqual(2) // webhook_events + conversions
  })

  it('returns 200 + duplicate when the event_id was already seen', async () => {
    state.selectRows = [{ id: 'prior' }]
    const res = await POST(signedRequest(JSON.stringify(makeEvent())))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { duplicate: boolean }
    expect(json.duplicate).toBe(true)
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })
})

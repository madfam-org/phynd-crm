import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock modules (must be declared before route import)
// ---------------------------------------------------------------------------

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 99 })
vi.mock('@/lib/webhooks/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

// In-memory DB mock. Tests set `priorEventIds` to simulate idempotent duplicates.
const state = {
  priorEventIds: new Set<string>(),
  inserted: {
    webhookEvents: [] as Array<Record<string, unknown>>,
    conversions: [] as Array<Record<string, unknown>>,
  },
}

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockImplementation(async () => {
          // Pull the event_id off the argument captured by `where` via a shared ref.
          return []
        }),
      })),
    })),
  })),
  insert: vi.fn(() => ({
    values: vi.fn((v: Record<string, unknown>) => ({
      returning: vi.fn().mockImplementation(async () => [{ id: 'gen-id' }]),
      then: (cb: (v: unknown) => unknown) => Promise.resolve([{ id: 'gen-id' }]).then(cb),
    })),
  })),
  transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockDb)),
}

vi.mock('@phyne/db', () => ({
  getDb: () => mockDb,
}))

vi.mock('@phyne/db/schema', () => ({
  conversions: { id: 'conversions.id' },
  contacts: { id: 'contacts.id', externalJanuaId: 'contacts.external_janua_id' },
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

// Now import the route under test
import { POST } from '../route'

const SECRET = 'whsec_test_routecraft_2026'
const PHYNE_CRM_EVENTS_SECRET_ORIGINAL = process.env.PHYNE_CRM_EVENTS_SECRET

function signedRequest(body: string, headerOverride?: string): Request {
  const ts = Math.floor(Date.now() / 1000)
  const hmac = crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex')
  const header = headerOverride ?? `t=${ts},v1=${hmac}`
  return new Request('http://localhost/api/webhooks/routecraft', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-madfam-signature': header,
      'x-forwarded-for': '10.0.0.1',
    },
    body,
  })
}

beforeEach(() => {
  process.env.PHYNE_CRM_EVENTS_SECRET = SECRET
  state.priorEventIds = new Set()
  state.inserted = { webhookEvents: [], conversions: [] }
  mockCheckRateLimit.mockClear().mockResolvedValue({ allowed: true, remaining: 99 })
  mockDb.select.mockClear()
  mockDb.insert.mockClear()
  mockDb.transaction.mockClear()
})

afterEach(() => {
  process.env.PHYNE_CRM_EVENTS_SECRET = PHYNE_CRM_EVENTS_SECRET_ORIGINAL
})

function makeEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schema_version: '1',
    event_id: 'evt_test_1',
    provider: 'stripe',
    subscription_id: 'sub_test_1',
    organization_id: 'org_test_1',
    amount_minor: 150_000,
    currency: 'MXN',
    occurred_at: '2026-04-17T12:00:00.000Z',
    attribution: { source_agent_id: 'agent_heraldo' },
    ...overrides,
  }
}

describe('POST /api/webhooks/routecraft', () => {
  it('returns 503 when PHYNE_CRM_EVENTS_SECRET is unset', async () => {
    delete process.env.PHYNE_CRM_EVENTS_SECRET
    const res = await POST(signedRequest(JSON.stringify(makeEvent())))
    expect(res.status).toBe(503)
  })

  it('returns 401 when the signature header is missing', async () => {
    const body = JSON.stringify(makeEvent())
    const req = new Request('http://localhost/api/webhooks/routecraft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when the signature is wrong', async () => {
    const body = JSON.stringify(makeEvent())
    const ts = Math.floor(Date.now() / 1000)
    const bogus = `t=${ts},v1=${'0'.repeat(64)}`
    const res = await POST(signedRequest(body, bogus))
    expect(res.status).toBe(401)
  })

  it('returns 400 when the payload is malformed JSON', async () => {
    const res = await POST(signedRequest('not json'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when required fields are missing', async () => {
    const bad = { schema_version: '1', event_id: 'x' } // missing other required fields
    const res = await POST(signedRequest(JSON.stringify(bad)))
    expect(res.status).toBe(400)
  })

  it('returns 429 when rate-limited', async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0 })
    const res = await POST(signedRequest(JSON.stringify(makeEvent())))
    expect(res.status).toBe(429)
  })

  it('returns 200 + status:recorded on the happy path', async () => {
    const res = await POST(signedRequest(JSON.stringify(makeEvent())))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { received: boolean; status: string }
    expect(json.received).toBe(true)
    expect(json.status).toBe('recorded')
    expect(mockDb.transaction).toHaveBeenCalled()
  })
})

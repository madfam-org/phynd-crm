import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock modules (declared before route import). Bodies are signed for real via
// the shared madfam-signature format, so the signature path is exercised
// end-to-end rather than stubbed.
// ---------------------------------------------------------------------------

const state = {
  selectRows: [] as Array<Record<string, unknown>>,
  insertedConversions: [] as Array<Record<string, unknown>>,
  insertedWebhookEvents: [] as Array<Record<string, unknown>>,
}

const selectChain = {
  from: vi.fn(() => selectChain),
  where: vi.fn(() => selectChain),
  orderBy: vi.fn(() => selectChain),
  limit: vi.fn(async () => state.selectRows),
}

const mockDb = {
  select: vi.fn(() => selectChain),
  insert: vi.fn((table: { __name?: string }) => ({
    values: vi.fn((row: Record<string, unknown>) => {
      if (table?.__name === 'conversions') state.insertedConversions.push(row)
      else state.insertedWebhookEvents.push(row)
      return { returning: vi.fn(async () => [{ id: 'gen-id' }]) }
    }),
  })),
  transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockDb)),
}

vi.mock('@phynd/db', () => ({
  getDb: () => mockDb,
  conversions: { __name: 'conversions', id: 'conversions.id' },
  leads: { __name: 'leads', id: 'leads.id', source: 'leads.source' },
  webhookEvents: {
    __name: 'webhook_events',
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

function sign(body: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const hmac = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
  return `t=${ts},v1=${hmac}`
}

function makeRequest(event: Record<string, unknown>, signature?: string) {
  const body = JSON.stringify(event)
  return new Request('https://phynd.test/api/v1/events/payment.refunded', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature === undefined
        ? { 'x-madfam-signature': sign(body) }
        : { 'x-madfam-signature': signature }),
    },
    body,
  })
}

/**
 * Read the single conversion the route should have written.
 *
 * Throws rather than returning undefined: if no conversion was recorded, the
 * assertion that follows would compare against undefined and report a confusing
 * mismatch instead of the real failure, which is that nothing was written.
 */
function firstConversion(): Record<string, unknown> {
  const row = state.insertedConversions[0]
  if (!row) throw new Error('expected a conversion row, none was inserted')
  return row
}

const baseEvent = {
  schema_version: '1',
  event_type: 'payment.refunded',
  event_id: 'payment.refunded:re_123',
  provider: 'stripe',
  subscription_id: 'sub_1',
  organization_id: 'org_1',
  amount_minor: 49900,
  currency: 'MXN',
  occurred_at: '2026-07-31T00:00:00Z',
}

describe('POST /api/v1/events/payment.refunded', () => {
  beforeEach(() => {
    process.env.PHYND_CRM_EVENTS_SECRET = SECRET
    state.selectRows = []
    state.insertedConversions = []
    state.insertedWebhookEvents = []
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.PHYND_CRM_EVENTS_SECRET
    delete process.env.PHYND_CRM_EVENTS_SECRET_PREVIOUS
  })

  it('503s when no secret is configured — never a silent accept', async () => {
    delete process.env.PHYND_CRM_EVENTS_SECRET
    const res = await POST(makeRequest(baseEvent))
    expect(res.status).toBe(503)
  })

  it('rejects a missing or wrong signature', async () => {
    expect((await POST(makeRequest(baseEvent, ''))).status).toBe(401)
    expect((await POST(makeRequest(baseEvent, 't=1,v1=deadbeef'))).status).toBe(401)
    const body = JSON.stringify(baseEvent)
    expect((await POST(makeRequest(baseEvent, sign(body, 'wrong-secret')))).status).toBe(401)
  })

  it('accepts a signature made with the previous secret during rotation', async () => {
    process.env.PHYND_CRM_EVENTS_SECRET = 'new-secret'
    process.env.PHYND_CRM_EVENTS_SECRET_PREVIOUS = SECRET
    state.selectRows = []
    const res = await POST(makeRequest(baseEvent))
    expect(res.status).toBe(201)
  })

  it('rejects an unsupported schema_version', async () => {
    const res = await POST(makeRequest({ ...baseEvent, schema_version: '2' }))
    expect(res.status).toBe(400)
  })

  it.each([
    'event_id',
    'provider',
    'subscription_id',
    'organization_id',
    'currency',
    'occurred_at',
  ])('rejects a missing %s', async (field) => {
    const res = await POST(makeRequest({ ...baseEvent, [field]: '' }))
    expect(res.status).toBe(400)
  })

  it('rejects a non-positive amount — a refund of zero reverses nothing', async () => {
    expect((await POST(makeRequest({ ...baseEvent, amount_minor: 0 }))).status).toBe(400)
    expect((await POST(makeRequest({ ...baseEvent, amount_minor: -100 }))).status).toBe(400)
  })

  it('is idempotent on event_id', async () => {
    state.selectRows = [{ id: 'existing-webhook-event' }]
    const res = await POST(makeRequest(baseEvent))
    const json = await res.json()
    expect(json).toMatchObject({ received: true, duplicate: true })
    expect(state.insertedConversions).toHaveLength(0)
  })

  /**
   * The reason this receiver exists. Selva's bandit consumes `conversions` as
   * rewards; a refund that does not reverse its conversion trains the optimiser
   * to favour whatever channel produces refunds.
   */
  it('records a NEGATIVE reversal conversion, not a positive one', async () => {
    // First select = idempotency (empty), second = probe lead lookup.
    let call = 0
    selectChain.limit = vi.fn(async () => (call++ === 0 ? [] : [{ id: 'lead_1' }]))

    const res = await POST(makeRequest(baseEvent))
    expect(res.status).toBe(201)

    expect(state.insertedConversions).toHaveLength(1)
    const conversion = firstConversion()
    expect(conversion.type).toBe('ecosystem_refund')
    expect(conversion.value).toBe('-499.00')
    expect(String(conversion.value).startsWith('-')).toBe(true)
  })

  it('keeps the refund magnitude positive in metadata for readability', async () => {
    let call = 0
    selectChain.limit = vi.fn(async () => (call++ === 0 ? [] : [{ id: 'lead_1' }]))

    await POST(makeRequest(baseEvent))
    const metadata = firstConversion().metadata as Record<string, unknown>
    expect(metadata.refunded_amount_minor).toBe(49900)
    expect(metadata.reverses).toBe('ecosystem_payment')
    expect(metadata.event_id).toBe('payment.refunded:re_123')
  })

  it('carries attribution through so the right actor is debited', async () => {
    let call = 0
    selectChain.limit = vi.fn(async () => (call++ === 0 ? [] : [{ id: 'lead_1' }]))

    await POST(
      makeRequest({
        ...baseEvent,
        attribution: { source_agent_id: 'agent_7', campaign_id: 'camp_x', referral_code: 'REF1' },
      }),
    )
    const metadata = firstConversion().metadata as Record<string, unknown>
    expect(metadata.source_agent_id).toBe('agent_7')
    expect(metadata.campaign_id).toBe('camp_x')
    expect(metadata.referral_code).toBe('REF1')
  })

  it('records the webhook event even with no probe lead to bind to', async () => {
    selectChain.limit = vi.fn(async () => [])
    const res = await POST(makeRequest(baseEvent))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.conversion_id).toBeNull()
    expect(state.insertedWebhookEvents).toHaveLength(1)
  })

  it('handles a partial refund without assuming the full original amount', async () => {
    let call = 0
    selectChain.limit = vi.fn(async () => (call++ === 0 ? [] : [{ id: 'lead_1' }]))

    await POST(makeRequest({ ...baseEvent, amount_minor: 10000 }))
    expect(firstConversion().value).toBe('-100.00')
  })
})

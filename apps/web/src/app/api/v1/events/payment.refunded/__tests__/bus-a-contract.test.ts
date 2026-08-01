/**
 * Bus A consumer contract — PhyndCRM's refund receiver.
 *
 * Third corner of `internal-devops/contracts/bus-a/`. Dhanam's producer
 * contract asserts it emits these exact bytes; RouteCraft's consumer contract
 * asserts it accepts them; this asserts PhyndCRM does too, and reverses the
 * conversion when it does.
 *
 * Why PhyndCRM specifically matters here: `conversions` are what Selva's
 * Thompson-sampling bandit consumes as **rewards**. A refund that fails to
 * reverse does not merely overstate revenue — it keeps crediting the source
 * agent for money that was given back, and trains the optimiser to favour
 * whatever channel produces refunds. A contract break on this endpoint is
 * therefore not a missing row; it is an optimiser learning the wrong thing,
 * quietly, for as long as it goes unnoticed.
 *
 * Bytes come from `raw_body` verbatim. The signature covers exact bytes, so a
 * test that re-serialized the envelope would verify against bytes no producer
 * will ever send.
 */
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

interface Fixture {
  event_type: string
  raw_body: string
  envelope: Record<string, unknown>
  signature_at_fixed_timestamp: string
}
interface FixtureDoc {
  contract_version: string
  signature_header: string
  signing: { secret: string }
  events: Fixture[]
}

// Resolved against this file, not process.cwd() — the working directory
// depends on how the runner is invoked (turbo per-package vs repo root), and a
// contract test that cannot find its own contract is a confusing way to fail.
const HERE = dirname(fileURLToPath(import.meta.url))
const doc: FixtureDoc = JSON.parse(
  readFileSync(
    join(HERE, '..', '..', '..', '..', '..', '..', 'lib', 'webhooks', '__contract__', 'bus-a', 'fixtures.json'),
    'utf8',
  ),
)
const SECRET = doc.signing.secret
const refunded = doc.events.find((e) => e.event_type === 'payment.refunded')!

function signedRequest(rawBody: string, ts = Math.floor(Date.now() / 1000)) {
  const mac = crypto.createHmac('sha256', SECRET).update(`${ts}.${rawBody}`).digest('hex')
  return new Request('https://phynd.test/api/v1/events/payment.refunded', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [doc.signature_header]: `t=${ts},v1=${mac}`,
    },
    body: rawBody,
  })
}

describe('Bus A consumer contract — payment.refunded', () => {
  beforeEach(() => {
    process.env.PHYND_CRM_EVENTS_SECRET = SECRET
    state.selectRows = []
    state.insertedConversions = []
    state.insertedWebhookEvents = []
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.PHYND_CRM_EVENTS_SECRET
  })

  it('is pinned to the contract version this receiver understands', () => {
    expect(doc.contract_version).toBe('1')
  })

  it('ACCEPTS the canonical refund event Dhanam emits', async () => {
    let call = 0
    selectChain.limit = vi.fn(async () => (call++ === 0 ? [] : [{ id: 'lead_1' }]))

    const res = await POST(signedRequest(refunded.raw_body))
    expect(res.status).toBe(201)
  })

  it('reverses the conversion with the canonical amount, negative', async () => {
    let call = 0
    selectChain.limit = vi.fn(async () => (call++ === 0 ? [] : [{ id: 'lead_1' }]))

    await POST(signedRequest(refunded.raw_body))

    const conversion = state.insertedConversions[0]
    if (!conversion) throw new Error('expected a reversal conversion, none was inserted')

    // The fixture is a PARTIAL refund on purpose (20000 of 49900): a consumer
    // that assumed the full original amount would reverse too much.
    const minor = refunded.envelope.amount_minor as number
    expect(minor).toBe(20000)
    expect(conversion.value).toBe(`-${(minor / 100).toFixed(2)}`)
    expect(conversion.type).toBe('ecosystem_refund')
    expect((conversion.metadata as Record<string, unknown>).refunded_amount_minor).toBe(minor)
  })

  it('binds the reversal to the canonical event_id for idempotency', async () => {
    let call = 0
    selectChain.limit = vi.fn(async () => (call++ === 0 ? [] : [{ id: 'lead_1' }]))

    await POST(signedRequest(refunded.raw_body))

    const conversion = state.insertedConversions[0]
    if (!conversion) throw new Error('expected a reversal conversion, none was inserted')
    expect((conversion.metadata as Record<string, unknown>).event_id).toBe(
      refunded.envelope.event_id,
    )
  })

  it('verifies against the canonical bytes, not a re-serialization', async () => {
    // Negative control for the raw-body class: same envelope, different bytes,
    // signature computed over the canonical ones. Must be refused.
    const reserialized = JSON.stringify(JSON.parse(refunded.raw_body), null, 2)
    expect(reserialized).not.toBe(refunded.raw_body)

    const ts = Math.floor(Date.now() / 1000)
    const mac = crypto
      .createHmac('sha256', SECRET)
      .update(`${ts}.${refunded.raw_body}`)
      .digest('hex')

    const res = await POST(
      new Request('https://phynd.test/api/v1/events/payment.refunded', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [doc.signature_header]: `t=${ts},v1=${mac}`,
        },
        body: reserialized,
      }),
    )
    expect(res.status).toBe(401)
  })
})

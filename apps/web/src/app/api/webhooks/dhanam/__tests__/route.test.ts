/**
 * Dhanam webhook — conversion attribution tests.
 *
 * The route's job (see route.ts header comment) is to take an inbound
 * Dhanam billing event and turn it into:
 *   - a `webhook_events` audit row (idempotency key = event_id)
 *   - a `conversions` row (revenue-attributed)
 *   - an updated `referrals` row when `metadata.referral_code` matches
 *   - the matching lead promoted to `closed_won` stage + status `converted`
 *   - an `engagement_events` timeline entry for the client portal
 *
 * These tests verify all five pathways plus the signature/rate-limit/idempotency
 * guards and the orphan path (event arrives, but we can't find the contact).
 */
import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks — must come before route import.
// ---------------------------------------------------------------------------

const { mockCheckRateLimit, mockValidateWebhookSignature, state, mockDb } = vi.hoisted(() => {
  const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 99 })
  const mockValidateWebhookSignature = vi.fn().mockReturnValue(true)

  // Per-test scenario state. Each `select(...).from(table)` call drives a
  // dispatcher that reads the appropriate slice of `state` to produce its
  // result. Tests mutate `state` in beforeEach to set up the scenario.
  const state = {
    priorEventIds: new Set<string>(),
    contactByJanuaId: new Map<string, string>(), // janua_id → contact_id
    contactByEmail: new Map<string, string>(), // email → contact_id
    leadByContactId: new Map<string, { id: string; pipelineId: string }>(),
    stagesByPipelineId: new Map<string, Array<{ id: string; name: string }>>(),
    referralCodeByCode: new Map<string, string>(), // code → referral_code_id
    referralByCodeIdAndEmail: new Map<string, string>(), // `${codeId}|${email}` → referral_id
    engagementByContactId: new Map<string, string>(),
    inserts: {
      webhookEvents: [] as Array<Record<string, unknown>>,
      conversions: [] as Array<Record<string, unknown>>,
      engagementEvents: [] as Array<Record<string, unknown>>,
    },
    updates: {
      leads: [] as Array<{ id: string; values: Record<string, unknown> }>,
      referrals: [] as Array<{ id: string; values: Record<string, unknown> }>,
    },
    nextId: 0,
  }

  // Track the active SELECT chain so the right table-specific result lands.
  let pendingSelectFrom = ''
  let pendingWhereCols: string[] = []
  let pendingWhereVals: unknown[] = []

  const captureWhereCondition = (cond: unknown): void => {
    if (!cond || typeof cond !== 'object') return
    const obj = cond as Record<string, unknown>
    if (obj._tag === 'eq' && typeof obj.col === 'string') {
      pendingWhereCols.push(obj.col)
      pendingWhereVals.push(obj.val)
    } else if (obj._tag === 'and' && Array.isArray(obj.args)) {
      for (const inner of obj.args) captureWhereCondition(inner)
    } else if (obj._tag === 'sql') {
      // sql template — capture the bound `event_id` for prior-event lookup.
      pendingWhereCols.push('sql')
      pendingWhereVals.push(obj.value)
    }
  }

  const resolveSelectResult = (): unknown[] => {
    const from = pendingSelectFrom
    const cols = pendingWhereCols
    const vals = pendingWhereVals

    if (from === 'webhook_events') {
      const eventId = String(vals[vals.length - 1] ?? '')
      return state.priorEventIds.has(eventId) ? [{ id: 'wh_existing' }] : []
    }
    if (from === 'contacts') {
      // Two strategies — janua match first, email fallback.
      const januaIdx = cols.findIndex((c) => c === 'contacts.externalJanuaId')
      if (januaIdx >= 0) {
        const id = state.contactByJanuaId.get(String(vals[januaIdx]))
        return id ? [{ id }] : []
      }
      const emailIdx = cols.findIndex((c) => c === 'contacts.email')
      if (emailIdx >= 0) {
        const id = state.contactByEmail.get(String(vals[emailIdx]))
        return id ? [{ id }] : []
      }
      return []
    }
    if (from === 'leads') {
      const cIdx = cols.findIndex((c) => c === 'leads.contactId')
      if (cIdx >= 0) {
        const lead = state.leadByContactId.get(String(vals[cIdx]))
        return lead ? [{ id: lead.id, pipelineId: lead.pipelineId }] : []
      }
      return []
    }
    if (from === 'pipeline_stages') {
      const pIdx = cols.findIndex((c) => c === 'pipelineStages.pipelineId')
      if (pIdx >= 0) {
        return state.stagesByPipelineId.get(String(vals[pIdx])) ?? []
      }
      return []
    }
    if (from === 'referral_codes') {
      const idx = cols.findIndex((c) => c === 'referralCodes.code')
      if (idx >= 0) {
        const codeId = state.referralCodeByCode.get(String(vals[idx]))
        return codeId ? [{ id: codeId }] : []
      }
      return []
    }
    if (from === 'referrals') {
      const codeIdIdx = cols.findIndex((c) => c === 'referrals.referralCodeId')
      const emailIdx = cols.findIndex((c) => c === 'referrals.referredEmail')
      if (codeIdIdx >= 0) {
        const codeId = String(vals[codeIdIdx])
        const email = emailIdx >= 0 ? String(vals[emailIdx]) : ''
        const refId = state.referralByCodeIdAndEmail.get(`${codeId}|${email}`)
        return refId ? [{ id: refId }] : []
      }
      return []
    }
    if (from === 'engagements') {
      const idx = cols.findIndex((c) => c === 'engagements.contactId')
      if (idx >= 0) {
        const id = state.engagementByContactId.get(String(vals[idx]))
        return id ? [{ id }] : []
      }
      return []
    }
    return []
  }

  // Drizzle query-builder shim — every chained method returns the same
  // object except `then`, which resolves to the dispatcher's verdict.
  const makeQb = () => {
    const qb = {
      from: vi.fn((table: unknown) => {
        pendingSelectFrom = String(table)
        return qb
      }),
      innerJoin: vi.fn(() => qb),
      where: vi.fn((cond: unknown) => {
        captureWhereCondition(cond)
        return qb
      }),
      orderBy: vi.fn(() => qb),
      limit: vi.fn(() => qb),
      values: vi.fn((v: Record<string, unknown>) => {
        // Lock in the inserted row so `returning()` can echo it back.
        ;(qb as unknown as Record<string, unknown>).__inserted = v
        return qb
      }),
      set: vi.fn((v: Record<string, unknown>) => {
        ;(qb as unknown as Record<string, unknown>).__updateValues = v
        return qb
      }),
      returning: vi.fn(() => {
        const inserted = (qb as unknown as Record<string, unknown>).__inserted as
          | Record<string, unknown>
          | undefined
        const id = `gen_${++state.nextId}`
        return Promise.resolve([{ id, ...(inserted ?? {}) }])
      }),
    } as unknown as Record<string, unknown> & PromiseLike<unknown[]>

    Object.defineProperty(qb, 'then', {
      value: (resolve: (v: unknown[]) => unknown) => {
        // Distinguish SELECT (resolves via dispatcher) from UPDATE (no
        // returning() chained — promise resolves to []).
        if (pendingSelectFrom) {
          const result = resolveSelectResult()
          // Reset for next chain.
          pendingSelectFrom = ''
          pendingWhereCols = []
          pendingWhereVals = []
          return Promise.resolve(result).then(resolve)
        }
        return Promise.resolve([]).then(resolve)
      },
      configurable: true,
    })

    return qb
  }

  const mockDb = {
    select: vi.fn(() => makeQb()),
    insert: vi.fn((table: unknown) => {
      const qb = makeQb()
      // Capture inserts by table for assertion.
      const tableName = String(table)
      const origValues = qb.values as ReturnType<typeof vi.fn>
      qb.values = vi.fn((v: Record<string, unknown>) => {
        if (tableName === 'webhook_events') state.inserts.webhookEvents.push(v)
        else if (tableName === 'conversions') state.inserts.conversions.push(v)
        else if (tableName === 'engagement_events') state.inserts.engagementEvents.push(v)
        return (origValues as (v: Record<string, unknown>) => unknown)(v)
      })
      return qb
    }),
    update: vi.fn((table: unknown) => {
      const qb = makeQb()
      const tableName = String(table)
      // Capture .where(eq(table.id, X)) so we know which row was updated.
      const origWhere = qb.where as ReturnType<typeof vi.fn>
      let capturedRowId = ''
      qb.where = vi.fn((cond: unknown) => {
        if (cond && typeof cond === 'object') {
          const obj = cond as Record<string, unknown>
          if (obj._tag === 'eq' && obj.col === `${tableName.replace('s', '')}s.id`) {
            capturedRowId = String(obj.val)
          }
          // For leads: col = "leads.id"
          if (obj._tag === 'eq' && (obj.col === 'leads.id' || obj.col === 'referrals.id')) {
            capturedRowId = String(obj.val)
          }
        }
        return (origWhere as (c: unknown) => unknown)(cond)
      })
      const origSet = qb.set as ReturnType<typeof vi.fn>
      qb.set = vi.fn((v: Record<string, unknown>) => {
        if (tableName === 'leads') {
          // We don't yet know the id; record after .where() runs.
          queueMicrotask(() => {
            if (capturedRowId) state.updates.leads.push({ id: capturedRowId, values: v })
          })
        } else if (tableName === 'referrals') {
          queueMicrotask(() => {
            if (capturedRowId) state.updates.referrals.push({ id: capturedRowId, values: v })
          })
        }
        return (origSet as (v: Record<string, unknown>) => unknown)(v)
      })
      return qb
    }),
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(mockDb)),
  }

  return { mockCheckRateLimit, mockValidateWebhookSignature, state, mockDb }
})

vi.mock('@/lib/webhooks/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

vi.mock('@phyne/federation', () => ({
  validateWebhookSignature: (...args: unknown[]) => mockValidateWebhookSignature(...args),
  CacheInvalidator: vi.fn().mockImplementation(() => ({
    invalidate: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('@/lib/federation/clients', () => ({
  getCacheManager: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('@phyne/db', () => ({
  getDb: vi.fn(() => mockDb),
}))

// Schema mock — each table object is the bare-minimum proxy we need:
// when stringified (which happens via `String(table)` in the dispatcher
// above), it returns the table name.
function tableMock(name: string, columns: Record<string, string>) {
  const tbl = {
    ...columns,
    toString: () => name,
    [Symbol.toPrimitive]: () => name,
  }
  return tbl
}

vi.mock('@phyne/db/schema', () => ({
  contacts: tableMock('contacts', {
    id: 'contacts.id',
    email: 'contacts.email',
    externalJanuaId: 'contacts.externalJanuaId',
    deletedAt: 'contacts.deletedAt',
  }),
  conversions: tableMock('conversions', {
    id: 'conversions.id',
  }),
  engagementEvents: tableMock('engagement_events', {
    id: 'engagementEvents.id',
  }),
  engagements: tableMock('engagements', {
    id: 'engagements.id',
    contactId: 'engagements.contactId',
    status: 'engagements.status',
    deletedAt: 'engagements.deletedAt',
    createdAt: 'engagements.createdAt',
  }),
  leads: tableMock('leads', {
    id: 'leads.id',
    contactId: 'leads.contactId',
    pipelineId: 'leads.pipelineId',
    deletedAt: 'leads.deletedAt',
    createdAt: 'leads.createdAt',
  }),
  pipelineStages: tableMock('pipeline_stages', {
    id: 'pipelineStages.id',
    pipelineId: 'pipelineStages.pipelineId',
    name: 'pipelineStages.name',
  }),
  pipelines: tableMock('pipelines', {
    id: 'pipelines.id',
  }),
  referralCodes: tableMock('referral_codes', {
    id: 'referralCodes.id',
    code: 'referralCodes.code',
  }),
  referrals: tableMock('referrals', {
    id: 'referrals.id',
    referralCodeId: 'referrals.referralCodeId',
    referredEmail: 'referrals.referredEmail',
    status: 'referrals.status',
    createdAt: 'referrals.createdAt',
  }),
  webhookEvents: tableMock('webhook_events', {
    id: 'webhookEvents.id',
    provider: 'webhookEvents.provider',
    payload: 'webhookEvents.payload',
  }),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  desc: vi.fn((col: unknown) => ({ _tag: 'desc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col: String(col), val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      _tag: 'sql',
      value: values[values.length - 1],
      raw: String.raw({ raw: strings }, ...values.map(String)),
    }),
    {
      raw: (s: string) => ({ _tag: 'sql_raw', value: s }),
    },
  ),
}))

vi.mock('@phyne/logging', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

import { POST } from '../route'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const SECRET = 'whsec_test_dhanam_2026'

function signedRequest(body: string, headerOverride?: string | null): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': '10.0.0.1',
  }
  if (headerOverride !== null) {
    const sig = headerOverride ?? crypto.createHmac('sha256', SECRET).update(body).digest('hex')
    headers['x-dhanam-signature'] = sig
  }
  return new Request('http://localhost/api/webhooks/dhanam', {
    method: 'POST',
    headers,
    body,
  })
}

function checkoutCompletedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_checkout_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        amount_total: 19900,
        currency: 'mxn',
        customer: 'cus_test_1',
        customer_email: 'tablaco@example.com',
        subscription: 'sub_test_1',
        metadata: {
          janua_user_id: 'janua_tablaco_001',
          plan: 'pro',
          referral_code: 'KRF-12345678',
          utm_source: 'google',
          utm_campaign: 'q2_launch',
        },
      },
    },
    ...overrides,
  }
}

beforeEach(() => {
  process.env.DHANAM_WEBHOOK_SECRET = SECRET
  // Reset state.
  state.priorEventIds.clear()
  state.contactByJanuaId.clear()
  state.contactByEmail.clear()
  state.leadByContactId.clear()
  state.stagesByPipelineId.clear()
  state.referralCodeByCode.clear()
  state.referralByCodeIdAndEmail.clear()
  state.engagementByContactId.clear()
  state.inserts.webhookEvents.length = 0
  state.inserts.conversions.length = 0
  state.inserts.engagementEvents.length = 0
  state.updates.leads.length = 0
  state.updates.referrals.length = 0
  state.nextId = 0

  mockCheckRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 99 })
  mockValidateWebhookSignature.mockReset().mockReturnValue(true)
})

afterEach(() => {
  delete process.env.DHANAM_WEBHOOK_SECRET
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/dhanam — signature verification', () => {
  it('returns 503 when DHANAM_WEBHOOK_SECRET is unset', async () => {
    delete process.env.DHANAM_WEBHOOK_SECRET
    const res = await POST(signedRequest(JSON.stringify(checkoutCompletedEvent())))
    expect(res.status).toBe(503)
  })

  it('returns 401 when the signature header is missing', async () => {
    mockValidateWebhookSignature.mockReturnValue(false)
    const res = await POST(signedRequest(JSON.stringify(checkoutCompletedEvent()), null))
    expect(res.status).toBe(401)
  })

  it('returns 401 when the signature does not match', async () => {
    mockValidateWebhookSignature.mockReturnValue(false)
    const res = await POST(signedRequest(JSON.stringify(checkoutCompletedEvent()), 'deadbeef'))
    expect(res.status).toBe(401)
  })

  it('returns 429 when rate-limited', async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0 })
    const res = await POST(signedRequest(JSON.stringify(checkoutCompletedEvent())))
    expect(res.status).toBe(429)
  })

  it('returns 400 on malformed JSON', async () => {
    const res = await POST(signedRequest('not-json'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the envelope is missing event_id or type', async () => {
    const res = await POST(signedRequest(JSON.stringify({ data: {} })))
    expect(res.status).toBe(400)
  })

  it('accepts the legacy x-webhook-signature header for backwards compat', async () => {
    const body = JSON.stringify(checkoutCompletedEvent())
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
    const req = new Request('http://localhost/api/webhooks/dhanam', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '10.0.0.1',
        // Note: x-webhook-signature, not x-dhanam-signature
        'x-webhook-signature': sig,
      },
      body,
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/webhooks/dhanam — happy path: checkout.session.completed', () => {
  it('writes webhook_events + conversions + promotes lead + writes engagement_event', async () => {
    state.contactByJanuaId.set('janua_tablaco_001', 'contact_tablaco')
    state.leadByContactId.set('contact_tablaco', { id: 'lead_tablaco', pipelineId: 'pipe_default' })
    state.stagesByPipelineId.set('pipe_default', [
      { id: 'stage_prospecting', name: 'Prospecting' },
      { id: 'stage_closed_won', name: 'Closed Won' },
    ])
    state.engagementByContactId.set('contact_tablaco', 'eng_tablaco')

    const res = await POST(signedRequest(JSON.stringify(checkoutCompletedEvent())))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { received: boolean; status: string; lead_id: string }
    expect(json.received).toBe(true)
    expect(json.status).toBe('recorded')
    expect(json.lead_id).toBe('lead_tablaco')

    // webhook_events written with the event_id at the top-level for
    // idempotency lookups.
    expect(state.inserts.webhookEvents).toHaveLength(1)
    const wh = state.inserts.webhookEvents[0]!
    expect(wh.provider).toBe('dhanam')
    expect(wh.eventType).toBe('checkout.session.completed')
    expect((wh.payload as Record<string, unknown>).event_id).toBe('evt_checkout_1')

    // conversions row carries the right type + revenue + metadata.
    expect(state.inserts.conversions).toHaveLength(1)
    const conv = state.inserts.conversions[0]!
    expect(conv.type).toBe('dhanam_checkout_completed')
    expect(conv.contactId).toBe('contact_tablaco')
    expect(conv.leadId).toBe('lead_tablaco')
    expect(conv.value).toBe('199.00')
    const meta = conv.metadata as Record<string, unknown>
    expect(meta.amount_minor).toBe(19900)
    expect(meta.currency).toBe('MXN')
    expect(meta.plan_id).toBe('pro')
    expect(meta.referral_code).toBe('KRF-12345678')
    expect(meta.utm).toMatchObject({ utm_source: 'google', utm_campaign: 'q2_launch' })
    expect(meta.janua_user_id).toBe('janua_tablaco_001')

    // Wait a microtask cycle so the queueMicrotask-buffered update
    // captures land in state.
    await new Promise((r) => setTimeout(r, 0))

    // Lead promoted to Closed Won + status converted.
    expect(state.updates.leads).toHaveLength(1)
    expect(state.updates.leads[0]!.values).toMatchObject({
      status: 'converted',
      stageId: 'stage_closed_won',
    })

    // Engagement event surfaced for the portal timeline.
    expect(state.inserts.engagementEvents).toHaveLength(1)
    const ee = state.inserts.engagementEvents[0]!
    expect(ee.engagementId).toBe('eng_tablaco')
    expect(ee.source).toBe('dhanam')
    expect(ee.eventType).toBe('dhanam:payment_succeeded')
    expect(ee.dedupKey).toBe('dhanam:evt_checkout_1')
  })

  it('looks up contact via email when janua_user_id is absent', async () => {
    state.contactByEmail.set('tablaco@example.com', 'contact_email_only')
    state.leadByContactId.set('contact_email_only', {
      id: 'lead_email_only',
      pipelineId: 'pipe_default',
    })
    state.stagesByPipelineId.set('pipe_default', [{ id: 'stage_won', name: 'Closed Won' }])

    // Strip janua_user_id from the metadata to force email-only matching.
    const event = checkoutCompletedEvent()
    const obj = (event.data.object as { metadata: Record<string, unknown> }).metadata
    delete obj.janua_user_id

    const res = await POST(signedRequest(JSON.stringify(event)))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { contact_id: string }
    expect(json.contact_id).toBe('contact_email_only')
  })

  it('still completes (200 + recorded) when the pipeline has no Closed Won stage', async () => {
    state.contactByJanuaId.set('janua_tablaco_001', 'contact_tablaco')
    state.leadByContactId.set('contact_tablaco', {
      id: 'lead_tablaco',
      pipelineId: 'pipe_grants',
    })
    state.stagesByPipelineId.set('pipe_grants', [
      { id: 'stage_discovered', name: 'Discovered' },
      { id: 'stage_awarded', name: 'Awarded' },
    ])

    const res = await POST(signedRequest(JSON.stringify(checkoutCompletedEvent())))
    expect(res.status).toBe(200)

    await new Promise((r) => setTimeout(r, 0))

    // Lead status promoted to converted but stage left alone (no Closed Won).
    expect(state.updates.leads).toHaveLength(1)
    expect(state.updates.leads[0]!.values).toMatchObject({ status: 'converted' })
    expect(state.updates.leads[0]!.values.stageId).toBeUndefined()
  })
})

describe('POST /api/webhooks/dhanam — orphan path', () => {
  it('returns 200 + status:orphan when no contact match exists, but records the webhook_event', async () => {
    // No state setup — contactByJanuaId + contactByEmail empty.
    const res = await POST(signedRequest(JSON.stringify(checkoutCompletedEvent())))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { received: boolean; status: string }
    expect(json.received).toBe(true)
    expect(json.status).toBe('orphan')

    // webhook_events row written for reconciliation.
    expect(state.inserts.webhookEvents).toHaveLength(1)
    // No conversion + no lead update + no engagement event.
    expect(state.inserts.conversions).toHaveLength(0)
    expect(state.inserts.engagementEvents).toHaveLength(0)
    expect(state.updates.leads).toHaveLength(0)
  })

  it('still records the orphan when the customer has no leads', async () => {
    state.contactByEmail.set('tablaco@example.com', 'contact_no_lead')
    // No lead for this contact.

    const res = await POST(
      signedRequest(JSON.stringify(checkoutCompletedEvent({ id: 'evt_no_lead' }))),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { status: string; lead_id: string | null }
    // Contact matched but no lead → recorded conversion against the
    // contact, lead_id is null.
    expect(json.status).toBe('recorded')
    expect(json.lead_id).toBeNull()
    expect(state.inserts.conversions).toHaveLength(1)
    expect(state.inserts.conversions[0]!.leadId).toBeNull()
  })
})

describe('POST /api/webhooks/dhanam — referral attribution', () => {
  it('promotes the matching pending referral to converted with revenue_cents populated', async () => {
    state.contactByJanuaId.set('janua_tablaco_001', 'contact_tablaco')
    state.leadByContactId.set('contact_tablaco', {
      id: 'lead_tablaco',
      pipelineId: 'pipe_default',
    })
    state.stagesByPipelineId.set('pipe_default', [{ id: 'stage_won', name: 'Closed Won' }])
    state.referralCodeByCode.set('KRF-12345678', 'rc_001')
    state.referralByCodeIdAndEmail.set('rc_001|tablaco@example.com', 'ref_001')

    const res = await POST(signedRequest(JSON.stringify(checkoutCompletedEvent())))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { referral_id: string }
    expect(json.referral_id).toBe('ref_001')

    await new Promise((r) => setTimeout(r, 0))

    expect(state.updates.referrals).toHaveLength(1)
    const update = state.updates.referrals[0]!
    expect(update.id).toBe('ref_001')
    expect(update.values).toMatchObject({
      status: 'converted',
      revenueCents: 19900,
      planId: 'pro',
      contactId: 'contact_tablaco',
      leadId: 'lead_tablaco',
    })
    expect(update.values.convertedAt).toBeInstanceOf(Date)
  })

  it('does nothing when the referral_code does not match any code', async () => {
    state.contactByJanuaId.set('janua_tablaco_001', 'contact_tablaco')
    state.leadByContactId.set('contact_tablaco', {
      id: 'lead_tablaco',
      pipelineId: 'pipe_default',
    })
    state.stagesByPipelineId.set('pipe_default', [{ id: 'stage_won', name: 'Closed Won' }])
    // No referralCodeByCode entry → mark logic should silently skip.

    const res = await POST(signedRequest(JSON.stringify(checkoutCompletedEvent())))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { referral_id: string | null }
    expect(json.referral_id).toBeNull()
    await new Promise((r) => setTimeout(r, 0))
    expect(state.updates.referrals).toHaveLength(0)
  })

  it('does nothing when the event has no referral_code in metadata', async () => {
    state.contactByJanuaId.set('janua_tablaco_001', 'contact_tablaco')
    state.leadByContactId.set('contact_tablaco', {
      id: 'lead_tablaco',
      pipelineId: 'pipe_default',
    })
    state.stagesByPipelineId.set('pipe_default', [{ id: 'stage_won', name: 'Closed Won' }])
    state.referralCodeByCode.set('KRF-12345678', 'rc_001')

    const event = checkoutCompletedEvent()
    const meta = (event.data.object as { metadata: Record<string, unknown> }).metadata
    delete meta.referral_code

    const res = await POST(signedRequest(JSON.stringify(event)))
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 0))
    expect(state.updates.referrals).toHaveLength(0)
  })
})

describe('POST /api/webhooks/dhanam — idempotency', () => {
  it('returns 200 + status:duplicate when the event_id was already processed', async () => {
    state.priorEventIds.add('evt_checkout_1')
    state.contactByJanuaId.set('janua_tablaco_001', 'contact_tablaco')

    const res = await POST(signedRequest(JSON.stringify(checkoutCompletedEvent())))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { status: string }
    expect(json.status).toBe('duplicate')

    // No new writes when duplicate.
    expect(state.inserts.webhookEvents).toHaveLength(0)
    expect(state.inserts.conversions).toHaveLength(0)
    expect(state.updates.leads).toHaveLength(0)
  })

  it('processes distinct event_ids independently', async () => {
    state.contactByJanuaId.set('janua_tablaco_001', 'contact_tablaco')
    state.leadByContactId.set('contact_tablaco', {
      id: 'lead_tablaco',
      pipelineId: 'pipe_default',
    })
    state.stagesByPipelineId.set('pipe_default', [{ id: 'stage_won', name: 'Closed Won' }])

    const res1 = await POST(signedRequest(JSON.stringify(checkoutCompletedEvent({ id: 'evt_a' }))))
    const res2 = await POST(signedRequest(JSON.stringify(checkoutCompletedEvent({ id: 'evt_b' }))))
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    expect(state.inserts.conversions).toHaveLength(2)
  })
})

describe('POST /api/webhooks/dhanam — Janua-shape envelope (flat data.*)', () => {
  it('handles the dhanam-relay envelope shape used by notifyProductWebhooks', async () => {
    state.contactByJanuaId.set('janua_user_xyz', 'contact_xyz')
    state.leadByContactId.set('contact_xyz', { id: 'lead_xyz', pipelineId: 'pipe_default' })
    state.stagesByPipelineId.set('pipe_default', [{ id: 'stage_won', name: 'Closed Won' }])

    const relayShape = {
      id: 'evt_relay_1',
      type: 'subscription.created',
      timestamp: new Date().toISOString(),
      data: {
        customer_id: 'janua_user_xyz',
        subscription_id: 'sub_relay_1',
        plan_id: 'karafiel_pro',
        organization_id: 'org_xyz',
        currency: 'MXN',
        amount: '499.00',
        status: 'created',
      },
    }

    const res = await POST(signedRequest(JSON.stringify(relayShape)))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { status: string }
    expect(json.status).toBe('recorded')

    expect(state.inserts.conversions).toHaveLength(1)
    const conv = state.inserts.conversions[0]!
    expect(conv.type).toBe('dhanam_subscription_created')
    // amount: '499.00' (major) → 49900 minor.
    expect((conv.metadata as Record<string, unknown>).amount_minor).toBe(49900)
    expect(conv.value).toBe('499.00')
  })
})

describe('POST /api/webhooks/dhanam — non-paid event types', () => {
  it('records the conversion but does NOT promote the lead on customer.subscription.updated', async () => {
    state.contactByJanuaId.set('janua_tablaco_001', 'contact_tablaco')
    state.leadByContactId.set('contact_tablaco', {
      id: 'lead_tablaco',
      pipelineId: 'pipe_default',
    })
    state.stagesByPipelineId.set('pipe_default', [{ id: 'stage_won', name: 'Closed Won' }])

    const event = {
      id: 'evt_updated_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_test_1',
          customer: 'cus_test_1',
          metadata: {
            janua_user_id: 'janua_tablaco_001',
            plan: 'pro_yearly',
          },
        },
      },
    }
    const res = await POST(signedRequest(JSON.stringify(event)))
    expect(res.status).toBe(200)

    await new Promise((r) => setTimeout(r, 0))

    // Conversion recorded for analytics.
    expect(state.inserts.conversions).toHaveLength(1)
    expect(state.inserts.conversions[0]!.type).toBe('dhanam_customer_subscription_updated')
    // Lead untouched — tier shuffles aren't won-state changes.
    expect(state.updates.leads).toHaveLength(0)
  })
})

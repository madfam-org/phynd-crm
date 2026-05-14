import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Shared mocks (must be initialized before route import because vi.mock is hoisted).
// ---------------------------------------------------------------------------

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 77 })
const mockValidateWebhookSignature = vi.fn().mockReturnValue(true)
const mockMarkAwarded = vi.fn()
const state = {
  priorEventIds: new Set<string>(),
  insertedWebhookRows: [] as Array<Record<string, unknown>>,
  currentEventId: '',
}

function createSelectBuilder() {
  return {
    from: vi.fn(function (this: Record<string, unknown>) {
      return this
    }),
    where: vi.fn(function (this: Record<string, unknown>) {
      return this
    }),
    limit: vi.fn(async () => {
      if (!state.currentEventId) return []
      return state.priorEventIds.has(state.currentEventId) ? [{ id: 'existing-wh' }] : []
    }),
  } as Record<string, unknown> as ReturnType<() => Record<string, unknown>>
}

function createInsertBuilder() {
  return {
    values: vi.fn(function (this: Record<string, unknown>, values: Record<string, unknown>) {
      state.insertedWebhookRows.push(values)
      return this
    }),
    returning: vi.fn(async () => [{ id: `wh_${state.insertedWebhookRows.length}` }]),
  } as Record<string, unknown> as ReturnType<() => Record<string, unknown>>
}

const mockDb = {
  select: vi.fn(() => createSelectBuilder()),
  insert: vi.fn(() => createInsertBuilder()),
  transaction: vi.fn(async (handler: (tx: unknown) => Promise<unknown>) => handler(mockDb)),
}

vi.mock('@/lib/webhooks/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

vi.mock('@phynd/federation/webhooks', () => ({
  validateWebhookSignature: (...args: unknown[]) => mockValidateWebhookSignature(...args),
}))

vi.mock('@phynd/config/constants', () => ({
  DEFAULT_TENANT_ID: 'madfam',
}))

vi.mock('@/lib/federation/clients', () => ({
  getCacheManager: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('@phynd/db', () => ({
  getDb: vi.fn(() => mockDb),
}))

vi.mock('@phynd/db/schema', () => ({
  webhookEvents: {
    id: 'webhook_events.id',
    provider: 'webhook_events.provider',
    payload: 'webhook_events.payload',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (col: unknown, val: unknown) => ({ _eq: [col, val] }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    _sql: String.raw(strings, ...values),
  }),
}))

vi.mock('@phynd/services', () => ({
  createServiceContext: vi.fn(() => ({})),
  GrantsService: vi.fn().mockImplementation(() => ({
    markAwarded: (...args: unknown[]) => mockMarkAwarded(...args),
  })),
}))

vi.mock('@phynd/logging', () => ({
  createLogger: vi.fn(() => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  })),
}))

import { POST } from '../route'

const SECRET = 'karafiel-test-secret-2026'
const KARAFIEL_WEBHOOK_SECRET_ORIGINAL = process.env.KARAFIEL_WEBHOOK_SECRET

function createRequest(
  payload: Record<string, unknown>,
  options: { signature?: string; timestamp?: string | null } = {},
) {
  const body = JSON.stringify(payload)
  const timestamp = options.timestamp === undefined ? new Date().toISOString() : options.timestamp
  const signature =
    options.signature ?? crypto.createHmac('sha256', SECRET).update(body).digest('hex')

  if (typeof payload.event_id === 'string') {
    state.currentEventId = payload.event_id
  } else {
    state.currentEventId = ''
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-phyndcrm-signature': signature,
    'x-forwarded-for': '10.0.0.42',
  }

  if (timestamp !== null) {
    headers['x-webhook-timestamp'] = timestamp
  }

  return new Request('http://localhost/api/webhooks/karafiel', {
    method: 'POST',
    headers,
    body,
  })
}

const validPayload = {
  event: 'grant.awarded',
  event_id: 'pp5-karafiel-event',
  data: {
    grantApplicationId: 'grant-app-001',
    awardedAmount: '42000.00',
  },
}

beforeEach(() => {
  process.env.KARAFIEL_WEBHOOK_SECRET = SECRET
  state.priorEventIds.clear()
  state.insertedWebhookRows = []
  state.currentEventId = ''
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 77 })
  mockValidateWebhookSignature.mockReturnValue(true)
  mockMarkAwarded.mockReset()
  vi.clearAllMocks()
})

afterEach(() => {
  if (KARAFIEL_WEBHOOK_SECRET_ORIGINAL === undefined) {
    delete process.env.KARAFIEL_WEBHOOK_SECRET
  } else {
    process.env.KARAFIEL_WEBHOOK_SECRET = KARAFIEL_WEBHOOK_SECRET_ORIGINAL
  }
})

describe('POST /api/webhooks/karafiel', () => {
  it('returns 503 when KARAFIEL_WEBHOOK_SECRET is unset', async () => {
    delete process.env.KARAFIEL_WEBHOOK_SECRET
    const res = await POST(createRequest(validPayload))
    expect(res.status).toBe(503)
  })

  it('returns 429 when request is rate-limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 })
    const res = await POST(createRequest(validPayload))
    expect(res.status).toBe(429)
  })

  it('returns 401 when timestamp header is missing', async () => {
    const res = await POST(createRequest(validPayload, { timestamp: null }))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Missing x-webhook-timestamp header' })
  })

  it('returns 401 when signature validation fails', async () => {
    mockValidateWebhookSignature.mockReturnValue(false)
    const res = await POST(createRequest(validPayload))
    expect(res.status).toBe(401)
  })

  it('returns 400 for malformed JSON', async () => {
    const badBody = 'not json'
    const signature = crypto.createHmac('sha256', SECRET).update(badBody).digest('hex')
    state.currentEventId = 'bad-json'
    const badReq = new Request('http://localhost/api/webhooks/karafiel', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-phyndcrm-signature': signature,
        'x-webhook-timestamp': new Date().toISOString(),
        'x-forwarded-for': '10.0.0.42',
      },
      body: badBody,
    })
    const res = await POST(badReq)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid JSON' })
  })

  it('returns 400 when event type is missing', async () => {
    const res = await POST(createRequest({ event_id: 'pp5-missing-type' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Missing event type' })
  })

  it('returns 200 for duplicate events without reprocessing', async () => {
    state.priorEventIds.add('pp5-karafiel-event')
    const res = await POST(createRequest(validPayload))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { status: string; event_id: string }
    expect(json).toMatchObject({ status: 'duplicate', event_id: 'pp5-karafiel-event' })
    expect(mockMarkAwarded).not.toHaveBeenCalled()
    expect(state.insertedWebhookRows.length).toBe(0)
  })

  it('records a webhook and applies grant.awarded when grantApplicationId exists', async () => {
    const awardedPayload = {
      ...validPayload,
      event_id: 'pp5-karafiel-award-ok',
      data: {
        grantApplicationId: 'grant-app-awarded',
        awardedAmount: '15000.50',
      },
    }

    const rowId = { id: 'grant-app-awarded', status: 'awarded' }
    mockMarkAwarded.mockResolvedValue(rowId)

    const res = await POST(createRequest(awardedPayload))
    expect(res.status).toBe(200)
    expect(mockMarkAwarded).toHaveBeenCalledTimes(1)
    expect(mockMarkAwarded).toHaveBeenCalledWith('grant-app-awarded', '15000.50')

    const body = (await res.json()) as { received: boolean; event_type: string }
    expect(body).toMatchObject({ received: true, event_type: 'grant.awarded' })
    expect(state.insertedWebhookRows.length).toBe(1)
    expect(state.insertedWebhookRows[0]?.provider).toBe('karafiel')
    expect(state.insertedWebhookRows[0]?.eventType).toBe('grant.awarded')
  })

  it('returns 200 for non-grant.awarded events without mutating grants', async () => {
    const nonAwardPayload = {
      event: 'grant.reviewed',
      event_id: 'pp5-karafiel-non-award',
      data: { grantApplicationId: 'grant-app-no-op' },
    }
    const res = await POST(createRequest(nonAwardPayload))
    expect(res.status).toBe(200)
    expect(mockMarkAwarded).not.toHaveBeenCalled()
    const body = (await res.json()) as { received: boolean; event_type: string }
    expect(body).toMatchObject({ received: true, event_type: 'grant.reviewed' })
  })
})

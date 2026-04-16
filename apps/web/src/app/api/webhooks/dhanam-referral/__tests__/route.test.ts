import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 99 })
vi.mock('@/lib/webhooks/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

const mockQb = {
  _result: [] as unknown[],
  from: vi.fn(),
  insert: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  returning: vi.fn(),
  select: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  values: vi.fn(),
  where: vi.fn(),
}

for (const method of Object.keys(mockQb).filter((k) => k !== '_result')) {
  ;(mockQb as unknown as Record<string, ReturnType<typeof vi.fn>>)[method]?.mockReturnValue(mockQb)
}

Object.defineProperty(mockQb, 'then', {
  value: vi.fn((resolve: (v: unknown) => void) => Promise.resolve(mockQb._result).then(resolve)),
  configurable: true,
  enumerable: false,
})

const mockDb = {
  delete: vi.fn().mockReturnValue(mockQb),
  insert: vi.fn().mockReturnValue(mockQb),
  select: vi.fn().mockReturnValue(mockQb),
  transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(mockDb)),
  update: vi.fn().mockReturnValue(mockQb),
}

vi.mock('@phyne/db', () => ({
  getDb: vi.fn(() => mockDb),
}))

vi.mock('@phyne/db/schema', () => ({
  campaigns: {
    channel: 'campaigns.channel',
    id: 'campaigns.id',
    spend: 'campaigns.spend',
  },
  contacts: {
    email: 'contacts.email',
    id: 'contacts.id',
    name: 'contacts.name',
    source: 'contacts.source',
    status: 'contacts.status',
  },
  conversions: {
    campaignId: 'conversions.campaignId',
    contactId: 'conversions.contactId',
    convertedAt: 'conversions.convertedAt',
    id: 'conversions.id',
    metadata: 'conversions.metadata',
    type: 'conversions.type',
    value: 'conversions.value',
  },
  leads: {
    contactId: 'leads.contactId',
    id: 'leads.id',
    pipelineId: 'leads.pipelineId',
    score: 'leads.score',
    source: 'leads.source',
    stageId: 'leads.stageId',
    status: 'leads.status',
  },
  pipelineStages: {
    id: 'pipelineStages.id',
    pipelineId: 'pipelineStages.pipelineId',
    position: 'pipelineStages.position',
  },
  pipelines: {
    id: 'pipelines.id',
    isDefault: 'pipelines.isDefault',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
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
// Helpers
// ---------------------------------------------------------------------------

function createSignedRequest(
  body: object,
  options: { secret?: string; customHeaders?: Record<string, string> } = {},
) {
  const secret = options.secret ?? 'test-dhanam-secret'
  const bodyStr = JSON.stringify(body)
  const signature = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex')

  return new Request('http://localhost/api/webhooks/dhanam-referral', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dhanam-Signature': signature,
      'X-Webhook-Timestamp': new Date().toISOString(),
      ...(options.customHeaders ?? {}),
    },
    body: bodyStr,
  })
}

const referralAppliedPayload = {
  id: 'evt-ref-001',
  type: 'referral.applied',
  timestamp: new Date().toISOString(),
  data: {
    referral_id: 'ref-001',
    referral_code: 'KRF-ABCD1234',
    referrer_user_id: 'user-referrer-001',
    referrer_email: 'referrer@example.com',
    referrer_name: 'Alice Referrer',
    referred_user_id: 'user-referred-001',
    referred_email: 'referred@example.com',
    referred_name: 'Bob Referred',
    source_product: 'karafiel',
    target_product: 'karafiel',
  },
}

const referralConvertedPayload = {
  id: 'evt-ref-002',
  type: 'referral.converted',
  timestamp: new Date().toISOString(),
  data: {
    referral_id: 'ref-002',
    referral_code: 'KRF-CONV0001',
    referrer_user_id: 'user-referrer-002',
    referrer_email: 'referrer2@example.com',
    referred_email: 'converted@example.com',
    referred_name: 'Carol Converted',
    source_product: 'karafiel',
    target_product: 'karafiel',
    plan_id: 'karafiel_pro',
    revenue_cents: 19900,
  },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dhanam referral webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DHANAM_WEBHOOK_SECRET = 'test-dhanam-secret'
    process.env.REDIS_URL = 'redis://localhost:6379'
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 99 })

    // Default DB mock chain: no existing contacts, returns new ones
    let selectCallCount = 0
    mockQb.then.mockImplementation((resolve: (v: unknown) => void) => {
      selectCallCount++
      // Chain: 1 - contact lookup, 2 - campaign lookup, 3 - pipeline lookup,
      //        4 - stage lookup, 5+ - inserts
      if (selectCallCount <= 2) {
        return Promise.resolve([]).then(resolve)
      }
      if (selectCallCount === 3) {
        // Default pipeline
        return Promise.resolve([{ id: 'pipeline-default', isDefault: true }]).then(resolve)
      }
      if (selectCallCount === 4) {
        // First pipeline stage
        return Promise.resolve([
          { id: 'stage-001', pipelineId: 'pipeline-default', position: 0 },
        ]).then(resolve)
      }
      // Insert returning calls
      return Promise.resolve([{ id: 'new-record-001' }]).then(resolve)
    })

    // Make insert().values().returning() return an array for destructuring
    mockQb.returning.mockReturnValue(
      Promise.resolve([{ id: 'new-contact-001', name: 'Bob Referred', email: 'referred@example.com' }]),
    )
  })

  afterEach(() => {
    delete process.env.DHANAM_WEBHOOK_SECRET
    delete process.env.REDIS_URL
  })

  // ─── Signature Verification ────────────────────────────────────────

  it('returns 503 when DHANAM_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.DHANAM_WEBHOOK_SECRET
    const req = createSignedRequest(referralAppliedPayload)
    const res = await POST(req)
    expect(res.status).toBe(503)
  })

  it('returns 401 when HMAC signature is invalid', async () => {
    const bodyStr = JSON.stringify(referralAppliedPayload)
    const req = new Request('http://localhost/api/webhooks/dhanam-referral', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dhanam-Signature': 'invalid-signature-value',
        'X-Webhook-Timestamp': new Date().toISOString(),
      },
      body: bodyStr,
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when timestamp is expired (>5 minutes)', async () => {
    const bodyStr = JSON.stringify(referralAppliedPayload)
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10 min ago
    const signature = crypto
      .createHmac('sha256', 'test-dhanam-secret')
      .update(bodyStr)
      .digest('hex')

    const req = new Request('http://localhost/api/webhooks/dhanam-referral', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dhanam-Signature': signature,
        'X-Webhook-Timestamp': oldTimestamp,
      },
      body: bodyStr,
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  // ─── Rate Limiting ─────────────────────────────────────────────────

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 })
    const req = createSignedRequest(referralAppliedPayload)
    const res = await POST(req)
    expect(res.status).toBe(429)
  })

  // ─── referral.applied ──────────────────────────────────────────────

  it('handles referral.applied — creates contact and lead', async () => {
    const req = createSignedRequest(referralAppliedPayload)
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ok')
    expect(json.type).toBe('referral.applied')

    // Verify DB insert was called (contacts + leads)
    expect(mockDb.insert).toHaveBeenCalled()
  })

  it('handles referral.applied with no referred_email gracefully', async () => {
    const payload = {
      ...referralAppliedPayload,
      data: {
        ...referralAppliedPayload.data,
        referred_email: undefined,
      },
    }

    const req = createSignedRequest(payload)
    const res = await POST(req)

    // Should still return 200 but skip processing
    expect(res.status).toBe(200)
  })

  // ─── referral.converted ────────────────────────────────────────────

  it('handles referral.converted — creates conversion record', async () => {
    // Setup mock to return an existing contact on lookup
    let selectCallCount = 0
    mockQb.then.mockImplementation((resolve: (v: unknown) => void) => {
      selectCallCount++
      if (selectCallCount === 1) {
        // Contact found
        return Promise.resolve([
          { id: 'contact-conv-001', email: 'converted@example.com' },
        ]).then(resolve)
      }
      if (selectCallCount === 2) {
        // Campaign found
        return Promise.resolve([
          { id: 'campaign-referral', channel: 'referral', spend: '0' },
        ]).then(resolve)
      }
      return Promise.resolve([{ id: 'conv-001' }]).then(resolve)
    })

    const req = createSignedRequest(referralConvertedPayload)
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ok')
    expect(json.type).toBe('referral.converted')

    // Verify conversion insert and campaign spend update
    expect(mockDb.insert).toHaveBeenCalled()
  })

  // ─── Malformed Payload ─────────────────────────────────────────────

  it('returns 400 for invalid JSON body', async () => {
    const secret = 'test-dhanam-secret'
    const invalidBody = 'not-valid-json'
    const signature = crypto
      .createHmac('sha256', secret)
      .update(invalidBody)
      .digest('hex')

    const req = new Request('http://localhost/api/webhooks/dhanam-referral', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dhanam-Signature': signature,
        'X-Webhook-Timestamp': new Date().toISOString(),
      },
      body: invalidBody,
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  // ─── Unknown Event Types ───────────────────────────────────────────

  it('ignores unknown event types and returns 200', async () => {
    const payload = {
      id: 'evt-unknown',
      type: 'referral.rewarded',
      timestamp: new Date().toISOString(),
      data: {
        referral_id: 'ref-unknown',
        referral_code: 'KRF-UNK00001',
        referrer_user_id: 'user-001',
        source_product: 'karafiel',
        target_product: 'karafiel',
      },
    }

    const req = createSignedRequest(payload)
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ok')
  })

  // ─── DB Error Handling ─────────────────────────────────────────────

  it('returns 500 when DB operation throws', async () => {
    mockDb.select.mockReturnValueOnce({
      ...mockQb,
      from: vi.fn().mockReturnValue({
        ...mockQb,
        where: vi.fn().mockReturnValue({
          ...mockQb,
          limit: vi.fn().mockRejectedValue(new Error('DB connection lost')),
        }),
      }),
    })

    const req = createSignedRequest(referralAppliedPayload)
    const res = await POST(req)

    expect(res.status).toBe(500)
  })
})

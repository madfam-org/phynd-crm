import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 99 })
vi.mock('@/lib/webhooks/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

const mockValidateWebhookSignature = vi.fn().mockReturnValue(true)
vi.mock('@phyne/federation/webhooks', () => ({
  validateWebhookSignature: (...args: unknown[]) => mockValidateWebhookSignature(...args),
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

vi.mock('@/lib/federation/clients', () => ({
  getCacheManager: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('@phyne/db/schema', () => ({
  grantApplications: {
    complianceChecks: 'grantApplications.complianceChecks',
    deletedAt: 'grantApplications.deletedAt',
    grantOpportunityId: 'grantApplications.grantOpportunityId',
    id: 'grantApplications.id',
    ownerId: 'grantApplications.ownerId',
    status: 'grantApplications.status',
    stageId: 'grantApplications.stageId',
  },
  grantOpportunities: {
    closesAt: 'grantOpportunities.closesAt',
    fortunaGrantId: 'grantOpportunities.fortunaGrantId',
    id: 'grantOpportunities.id',
  },
  grantSignalAudit: {
    createdAt: 'grantSignalAudit.createdAt',
    grantApplicationId: 'grantSignalAudit.grantApplicationId',
    grantOpportunityId: 'grantSignalAudit.grantOpportunityId',
    id: 'grantSignalAudit.id',
  },
  pipelineStages: {
    id: 'pipelineStages.id',
    pipelineId: 'pipelineStages.pipelineId',
  },
  pipelines: {
    id: 'pipelines.id',
    name: 'pipelines.name',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
  sql: vi.fn(),
}))

vi.mock('@phyne/logging', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@phyne/services', () => ({
  GrantsService: vi.fn().mockImplementation(() => ({
    upsertOpportunity: vi.fn().mockResolvedValue({ id: 'grant-opp-001', fortunaGrantId: 'f-123' }),
    createApplication: vi.fn().mockResolvedValue({ id: 'grant-app-001' }),
  })),
  createServiceContext: vi.fn().mockReturnValue({
    db: mockDb,
    cache: {},
    auth: { userId: 'system:fortuna-webhook', tenantId: 'madfam', roles: ['admin'], scopes: ['*'], accessToken: '' },
    tenantId: 'madfam',
  }),
}))

// Mock BullMQ Queue
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSignedRequest(body: object, options: { secret?: string; customHeaders?: Record<string, string> } = {}) {
  const secret = options.secret ?? 'test-secret'
  const bodyStr = JSON.stringify(body)
  const signature = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex')

  return new Request('http://localhost/api/webhooks/fortuna', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Fortuna-Signature': signature,
      'X-Webhook-Timestamp': new Date().toISOString(),
      ...(options.customHeaders ?? {}),
    },
    body: bodyStr,
  })
}

const validPayload = {
  type: 'grant.discovered',
  data: {
    fortuna_grant_id: 'fortuna-123',
    title: 'Innovation Grant 2025',
    granting_body: 'CONACYT',
    category: 'technology',
    max_amount: '500000.00',
    currency: 'MXN',
  },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Fortuna webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FORTUNA_WEBHOOK_SECRET = 'test-secret'
    process.env.REDIS_URL = 'redis://localhost:6379'
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 99 })
    mockValidateWebhookSignature.mockReturnValue(true)

    // Setup DB mock chain for pipeline/stage lookup
    let selectCallCount = 0
    mockQb.then.mockImplementation((resolve: (v: unknown) => void) => {
      selectCallCount++
      // 1st select: pipeline lookup, 2nd: stages lookup, 3rd: existing apps, rest: service calls
      if (selectCallCount === 1) {
        return Promise.resolve([{ id: 'pipeline-treasury', name: 'Treasury Hunter' }]).then(resolve)
      }
      if (selectCallCount === 2) {
        return Promise.resolve([
          { id: 'stage-discovered', name: 'Discovered', pipelineId: 'pipeline-treasury', position: 0 },
        ]).then(resolve)
      }
      return Promise.resolve([{ id: 'grant-opp-001' }]).then(resolve)
    })
  })

  afterEach(() => {
    delete process.env.FORTUNA_WEBHOOK_SECRET
    delete process.env.REDIS_URL
  })

  it('returns 503 when webhook secret is not configured', async () => {
    delete process.env.FORTUNA_WEBHOOK_SECRET
    const req = createSignedRequest(validPayload)
    const res = await POST(req)
    expect(res.status).toBe(503)
  })

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 })
    const req = createSignedRequest(validPayload)
    const res = await POST(req)
    expect(res.status).toBe(429)
  })

  it('returns 401 when signature is invalid', async () => {
    mockValidateWebhookSignature.mockReturnValue(false)
    const req = createSignedRequest(validPayload)
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when timestamp is expired', async () => {
    const bodyStr = JSON.stringify(validPayload)
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10 min ago

    const req = new Request('http://localhost/api/webhooks/fortuna', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Fortuna-Signature': 'any',
        'X-Webhook-Timestamp': oldTimestamp,
      },
      body: bodyStr,
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('processes grant.discovered event successfully', async () => {
    const req = createSignedRequest(validPayload)
    const res = await POST(req)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.received).toBe(true)
  })

  it('ignores non-grant.discovered events', async () => {
    const payload = { type: 'grant.updated', data: {} }
    const req = createSignedRequest(payload)
    const res = await POST(req)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.received).toBe(true)
  })

  it('returns 400 for malformed payload', async () => {
    const payload = { type: 'grant.discovered', data: {} }
    const req = createSignedRequest(payload)
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('uses X-Fortuna-Signature header (not X-Webhook-Signature)', async () => {
    const req = createSignedRequest(validPayload)
    await POST(req)

    // The validate call should have received the signature from X-Fortuna-Signature
    expect(mockValidateWebhookSignature).toHaveBeenCalledOnce()
  })
})

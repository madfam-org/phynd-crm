/**
 * Pravara webhook — dual-write test (native + canonical milestone alias).
 *
 * On `status=shipped`, the webhook must write TWO engagement_events rows:
 *   Row 1 — `pravara:shipped` (native, source-scoped)
 *   Row 2 — `pravara:prototype_shipped` (canonical cross-source alias)
 * Each with a distinct dedup_key so they're independently idempotent.
 *
 * See docs/ENGAGEMENT_EVENT_TAXONOMY.md for the canonical milestone list.
 */
import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — follow the pattern in the fortuna webhook test.
// ---------------------------------------------------------------------------

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 99 })
vi.mock('@/lib/webhooks/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

const mockValidateWebhookSignature = vi.fn().mockReturnValue(true)
vi.mock('@phynd/federation/webhooks', () => ({
  validateWebhookSignature: (...args: unknown[]) => mockValidateWebhookSignature(...args),
}))

vi.mock('@phynd/federation', () => ({
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

// Minimal Drizzle query-builder chain mock. `then` resolves `_result` so
// we can swap the promise payload per-call.
const mockQb = {
  _result: [] as unknown[],
  from: vi.fn(),
  insert: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  select: vi.fn(),
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
  insert: vi.fn().mockReturnValue(mockQb),
  select: vi.fn().mockReturnValue(mockQb),
}
vi.mock('@phynd/db', () => ({
  getDb: vi.fn(() => mockDb),
}))

vi.mock('@phynd/db/schema', () => ({
  activities: { entityType: 'activities.entityType', entityId: 'activities.entityId' },
  engagements: {
    id: 'engagements.id',
    contactId: 'engagements.contactId',
    status: 'engagements.status',
    deletedAt: 'engagements.deletedAt',
    createdAt: 'engagements.createdAt',
  },
  externalReferences: {
    externalId: 'externalReferences.externalId',
    entityId: 'externalReferences.entityId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

vi.mock('@phynd/logging', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

// `recordEvent` is the hot path we're verifying — track all invocations
// to assert the dual-write on status=shipped. Hoisted for Vitest hoisting.
const { mockRecordEvent } = vi.hoisted(() => ({
  mockRecordEvent: vi.fn().mockResolvedValue({ deduplicated: false }),
}))

vi.mock('@phynd/services', () => ({
  EngagementsService: vi.fn().mockImplementation(() => ({
    recordEvent: mockRecordEvent,
  })),
}))

import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSignedRequest(body: object, options: { secret?: string } = {}) {
  const secret = options.secret ?? 'test-pravara-secret'
  const bodyStr = JSON.stringify(body)
  const signature = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex')
  return new Request('http://localhost/api/webhooks/pravara', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-signature': signature,
      'x-webhook-timestamp': new Date().toISOString(),
    },
    body: bodyStr,
  })
}

describe('Pravara webhook — engagement dual-write', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PRAVARA_WEBHOOK_SECRET = 'test-pravara-secret'
    process.env.REDIS_URL = 'redis://localhost:6379'
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 99 })
    mockValidateWebhookSignature.mockReturnValue(true)
    mockRecordEvent.mockResolvedValue({ deduplicated: false })

    // Default DB resolution — explicit engagementId path skips contact
    // lookup; if the test payload omits it, we fall through to looking
    // up an active engagement for the contact. Default to empty so tests
    // provide explicit engagementId.
    mockQb._result = []
  })

  afterEach(() => {
    delete process.env.PRAVARA_WEBHOOK_SECRET
    delete process.env.REDIS_URL
  })

  it('returns 503 when PRAVARA_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.PRAVARA_WEBHOOK_SECRET
    const req = createSignedRequest({
      event: 'status_changed',
      status: 'shipped',
      contactId: 'contact_1',
      engagementId: 'eng_1',
    })
    const res = await POST(req)
    expect(res.status).toBe(503)
  })

  it('on status=shipped, writes BOTH native (pravara:shipped) AND canonical (pravara:prototype_shipped)', async () => {
    const payload = {
      event: 'status_changed',
      status: 'shipped',
      contactId: 'contact_tablaco',
      engagementId: 'eng_tablaco',
      orderId: 'order_123',
      externalId: 'pravara-order-123',
    }
    const req = createSignedRequest(payload)
    const res = await POST(req)
    expect(res.status).toBe(200)

    // Two recordEvent calls: native then canonical alias.
    expect(mockRecordEvent).toHaveBeenCalledTimes(2)

    const [firstCall, secondCall] = mockRecordEvent.mock.calls.map((c) => c[0])

    // Row 1 — source-native
    expect(firstCall).toMatchObject({
      engagementId: 'eng_tablaco',
      source: 'pravara',
      eventType: 'pravara:status_changed',
      status: 'milestone',
      dedupKey: 'pravara:order_123:shipped',
    })

    // Row 2 — canonical cross-source alias
    expect(secondCall).toMatchObject({
      engagementId: 'eng_tablaco',
      source: 'pravara',
      eventType: 'pravara:prototype_shipped',
      status: 'milestone',
      dedupKey: 'pravara:order_123:milestone:prototype_shipped',
    })
    expect((secondCall.metadata as Record<string, unknown>).canonical_milestone).toBe(
      'prototype_shipped',
    )
  })

  it('on status=delivered, writes canonical deliverable_received alias', async () => {
    const payload = {
      event: 'status_changed',
      status: 'delivered',
      contactId: 'contact_tablaco',
      engagementId: 'eng_tablaco',
      orderId: 'order_456',
    }
    const req = createSignedRequest(payload)
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockRecordEvent).toHaveBeenCalledTimes(2)
    const [, canonicalCall] = mockRecordEvent.mock.calls.map((c) => c[0])
    expect(canonicalCall.eventType).toBe('pravara:deliverable_received')
    expect(canonicalCall.status).toBe('milestone')
    expect(canonicalCall.dedupKey).toBe('pravara:order_456:milestone:deliverable_received')
  })

  it('on non-milestone status (in_progress), writes ONLY the native row — no canonical alias', async () => {
    const payload = {
      event: 'status_changed',
      status: 'in_progress',
      contactId: 'contact_tablaco',
      engagementId: 'eng_tablaco',
      orderId: 'order_789',
    }
    const req = createSignedRequest(payload)
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockRecordEvent).toHaveBeenCalledTimes(1)
    const [nativeCall] = mockRecordEvent.mock.calls.map((c) => c[0])
    expect(nativeCall.eventType).toBe('pravara:status_changed')
    expect(nativeCall.status).toBe('in_progress')
  })

  it('distinct dedup_keys for native vs canonical — prevents cross-contamination of idempotency', async () => {
    const payload = {
      event: 'status_changed',
      status: 'shipped',
      contactId: 'contact_1',
      engagementId: 'eng_1',
      orderId: 'order_unique',
    }
    const req = createSignedRequest(payload)
    await POST(req)

    const [native, canonical] = mockRecordEvent.mock.calls.map((c) => c[0])
    expect(native.dedupKey).not.toBe(canonical.dedupKey)
    // The canonical alias dedup includes `:milestone:<name>` so a replay
    // of the raw status event doesn't collide with it.
    expect(canonical.dedupKey).toMatch(/:milestone:prototype_shipped$/)
  })

  it('accepts payload with snake_case engagement_id (not camelCase)', async () => {
    // Dhanam + Cotiza producers send snake_case metadata. Pravara's
    // native webhook also supports snake_case fallback.
    const payload = {
      event: 'status_changed',
      status: 'shipped',
      contactId: 'contact_snake',
      engagement_id: 'eng_snake',
      orderId: 'order_snake',
    }
    const req = createSignedRequest(payload)
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockRecordEvent).toHaveBeenCalled()
    const [firstCall] = mockRecordEvent.mock.calls.map((c) => c[0])
    expect(firstCall.engagementId).toBe('eng_snake')
  })
})

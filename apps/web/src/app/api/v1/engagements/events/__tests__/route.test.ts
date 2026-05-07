/**
 * /api/v1/engagements/events — unified engagement-event webhook.
 *
 * Contract verified:
 *   - 503 when PHYNE_ENGAGEMENT_EVENTS_SECRET is unset (fail-closed)
 *   - HMAC signature + timestamp validation via shared handleWebhook
 *   - payloads missing engagement_id/source/event_type are dropped silently (no throw)
 *   - explicit dedup_key from caller is preserved
 *   - derived dedup_key shape when caller omits it: `<source>:<event_type>:<timestamp>`
 *   - source-scoped auth (service:<source>) passed to EngagementsService
 */
import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 99 })
vi.mock('@/lib/webhooks/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

const mockValidateWebhookSignature = vi.fn().mockReturnValue(true)
vi.mock('@phyne/federation/webhooks', () => ({
  validateWebhookSignature: (...args: unknown[]) => mockValidateWebhookSignature(...args),
}))

vi.mock('@phyne/db', () => ({
  getDb: vi.fn(() => ({})),
}))

vi.mock('@phyne/logging', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

// Vitest hoists `vi.mock` to the top of the file, so the factory closure
// can't reference top-level consts directly. Use vi.hoisted to share refs.
const { mockRecordEvent, EngagementsServiceMock } = vi.hoisted(() => {
  const mockRecordEvent = vi.fn().mockResolvedValue({ deduplicated: false })
  const EngagementsServiceMock = vi.fn().mockImplementation(() => ({
    recordEvent: mockRecordEvent,
  }))
  return { mockRecordEvent, EngagementsServiceMock }
})

vi.mock('@phyne/services', () => ({
  EngagementsService: EngagementsServiceMock,
}))

import { POST } from '../route'

type RecordedEngagementEvent = {
  engagementId: string
  source: string
  eventType: string
  status?: string
  dedupKey: string
  metadata?: Record<string, unknown>
}

function getRecordedEventArg(): RecordedEngagementEvent {
  const call = mockRecordEvent.mock.calls[0]
  expect(call).toBeDefined()
  return call?.[0] as RecordedEngagementEvent
}

function createSignedRequest(body: object, options: { secret?: string } = {}) {
  const secret = options.secret ?? 'test-events-secret'
  const bodyStr = JSON.stringify(body)
  const signature = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex')
  return new Request('http://localhost/api/v1/engagements/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-signature': signature,
      'x-webhook-timestamp': new Date().toISOString(),
    },
    body: bodyStr,
  })
}

describe('POST /api/v1/engagements/events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PHYNE_ENGAGEMENT_EVENTS_SECRET = 'test-events-secret'
    process.env.REDIS_URL = 'redis://localhost:6379'
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 99 })
    mockValidateWebhookSignature.mockReturnValue(true)
    mockRecordEvent.mockResolvedValue({ deduplicated: false })
  })

  afterEach(() => {
    delete process.env.PHYNE_ENGAGEMENT_EVENTS_SECRET
    delete process.env.REDIS_URL
  })

  it('returns 503 when PHYNE_ENGAGEMENT_EVENTS_SECRET is unset (fail-closed)', async () => {
    delete process.env.PHYNE_ENGAGEMENT_EVENTS_SECRET
    const req = createSignedRequest({
      engagement_id: 'eng_1',
      source: 'dhanam',
      event_type: 'payment.succeeded',
    })
    const res = await POST(req)
    expect(res.status).toBe(503)
    expect(mockRecordEvent).not.toHaveBeenCalled()
  })

  it('returns 401 on forged signature', async () => {
    mockValidateWebhookSignature.mockReturnValueOnce(false)
    const req = createSignedRequest({
      engagement_id: 'eng_1',
      source: 'dhanam',
      event_type: 'payment.succeeded',
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(mockRecordEvent).not.toHaveBeenCalled()
  })

  it('accepts a well-formed Dhanam payment.succeeded payload', async () => {
    const payload = {
      engagement_id: 'eng_tablaco',
      source: 'dhanam',
      event_type: 'payment.succeeded',
      status: 'completed',
      message: 'Payment received: 199.00 MXN',
      timestamp: '2026-04-19T09:00:00.000Z',
      dedup_key: 'dhanam:payment.succeeded:pi_abc',
      metadata: {
        payment_id: 'pi_abc',
        cotiza_quote_id: 'q_1',
      },
    }
    const req = createSignedRequest(payload)
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockRecordEvent).toHaveBeenCalledTimes(1)

    const arg = getRecordedEventArg()
    expect(arg).toMatchObject({
      engagementId: 'eng_tablaco',
      source: 'dhanam',
      eventType: 'payment.succeeded',
      status: 'completed',
      // Caller-provided dedup_key is preserved verbatim.
      dedupKey: 'dhanam:payment.succeeded:pi_abc',
    })
    expect((arg.metadata as Record<string, unknown>).cotiza_quote_id).toBe('q_1')
  })

  it('derives dedup_key when caller omits it (format: source:eventType:timestamp)', async () => {
    const payload = {
      engagement_id: 'eng_1',
      source: 'cotiza',
      event_type: 'quote_approved',
      timestamp: '2026-04-19T09:00:00.000Z',
      // dedup_key intentionally omitted
    }
    const req = createSignedRequest(payload)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const arg = getRecordedEventArg()
    // Shape of the derived key must be stable so a replay produces the same key.
    expect(arg.dedupKey).toBe('cotiza:quote_approved:2026-04-19T09:00:00.000Z')
  })

  it('drops payloads missing engagement_id without calling recordEvent', async () => {
    const payload = { source: 'dhanam', event_type: 'payment.succeeded' }
    const req = createSignedRequest(payload)
    const res = await POST(req)
    // handleWebhook returns 200 when onEvent resolves — the guard inside
    // the route logs + returns early so no recordEvent fires.
    expect(res.status).toBe(200)
    expect(mockRecordEvent).not.toHaveBeenCalled()
  })

  it('drops payloads missing source', async () => {
    const payload = { engagement_id: 'eng_1', event_type: 'payment.succeeded' }
    const req = createSignedRequest(payload)
    await POST(req)
    expect(mockRecordEvent).not.toHaveBeenCalled()
  })

  it('drops payloads missing event_type', async () => {
    const payload = { engagement_id: 'eng_1', source: 'dhanam' }
    const req = createSignedRequest(payload)
    await POST(req)
    expect(mockRecordEvent).not.toHaveBeenCalled()
  })

  it('passes source-scoped service auth context (userId = service:<source>)', async () => {
    const payload = {
      engagement_id: 'eng_1',
      source: 'dhanam',
      event_type: 'payment.succeeded',
      timestamp: '2026-04-19T09:00:00.000Z',
    }
    const req = createSignedRequest(payload)
    await POST(req)
    // First call's ctor args: { db, cache, auth, tenantId }
    const ctorArgs = EngagementsServiceMock.mock.calls.at(-1)?.[0]
    expect(ctorArgs?.auth).toMatchObject({
      userId: 'service:dhanam',
      tenantId: 'madfam',
      roles: ['service'],
    })
    expect(ctorArgs?.tenantId).toBe('madfam')
  })
})

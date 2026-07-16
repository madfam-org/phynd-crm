/**
 * /api/v1/ops/events — ops-events ingress (CRM↔Ops↔Checkout loop).
 *
 * Contract verified:
 *   - 503 when PHYND_OPS_EVENTS_SECRET is unset (fail-closed)
 *   - HMAC signature + timestamp validation via the shared parser (401 on forge)
 *   - a valid signed event is handed to OpsEventsService.ingest with an
 *     'ops'-scoped service auth context
 *   - accepted → 200 { received, contact_id, activity_id, offer_id }
 *   - unresolvable subject → 202 { skipped } (never a 500)
 *   - duplicate replay → 200 { deduplicated: true }
 */
import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 99 })
vi.mock('@/lib/webhooks/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

const mockValidateWebhookSignature = vi.fn().mockReturnValue(true)
vi.mock('@phynd/federation/webhooks', () => ({
  validateWebhookSignature: (...args: unknown[]) => mockValidateWebhookSignature(...args),
}))

vi.mock('@phynd/db', () => ({
  getDb: vi.fn(() => ({})),
}))

vi.mock('@phynd/logging', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

const { mockIngest, OpsEventsServiceMock } = vi.hoisted(() => {
  const mockIngest = vi.fn()
  const OpsEventsServiceMock = vi.fn().mockImplementation(() => ({ ingest: mockIngest }))
  return { mockIngest, OpsEventsServiceMock }
})

vi.mock('@phynd/services', () => ({
  OpsEventsService: OpsEventsServiceMock,
}))

import { POST } from '../route'

function signedEvent(body: object, options: { secret?: string } = {}) {
  const secret = options.secret ?? 'test-ops-secret'
  const bodyStr = JSON.stringify(body)
  const signature = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex')
  return new Request('http://localhost/api/v1/ops/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-signature': signature,
      'x-webhook-timestamp': new Date().toISOString(),
    },
    body: bodyStr,
  })
}

const usageEvent = {
  schema_version: 'madfam.ops.v1',
  id: 'evt_usage_1',
  event_type: 'ops.usage_limit_approaching',
  source: 'dhanam',
  correlation_id: 'corr_1',
  timestamp: '2026-07-16T15:04:05Z',
  dedup_key: 'dhanam:ops.usage_limit_approaching:proj_abc:2026-07-01:80',
  subject: { email: 'ops@clientco.mx', dhanam_customer_id: 'usr_1' },
  payload: {
    meter: 'waybill_budget',
    threshold_crossed: 80,
    current_plan: 'community',
    suggested_plan: 'pro',
    period_start: '2026-07-01T00:00:00Z',
  },
}

describe('POST /api/v1/ops/events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PHYND_OPS_EVENTS_SECRET = 'test-ops-secret'
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 99 })
    mockValidateWebhookSignature.mockReturnValue(true)
    mockIngest.mockResolvedValue({
      status: 'accepted',
      contactId: 'contact_1',
      activityId: 'activity_1',
      offerId: 'offer_1',
    })
  })

  afterEach(() => {
    delete process.env.PHYND_OPS_EVENTS_SECRET
  })

  it('returns 503 when PHYND_OPS_EVENTS_SECRET is unset (fail-closed)', async () => {
    delete process.env.PHYND_OPS_EVENTS_SECRET
    const res = await POST(signedEvent(usageEvent))
    expect(res.status).toBe(503)
    expect(mockIngest).not.toHaveBeenCalled()
  })

  it('returns 401 on a forged signature', async () => {
    mockValidateWebhookSignature.mockReturnValueOnce(false)
    const res = await POST(signedEvent(usageEvent))
    expect(res.status).toBe(401)
    expect(mockIngest).not.toHaveBeenCalled()
  })

  it('accepts a valid signed event and returns the written row ids', async () => {
    const res = await POST(signedEvent(usageEvent))
    expect(res.status).toBe(200)
    expect(mockIngest).toHaveBeenCalledTimes(1)
    expect(mockIngest).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt_usage_1' }))

    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      received: true,
      deduplicated: false,
      contact_id: 'contact_1',
      activity_id: 'activity_1',
      offer_id: 'offer_1',
    })

    // Service context is 'ops'-scoped.
    const ctorArgs = OpsEventsServiceMock.mock.calls.at(-1)?.[0]
    expect(ctorArgs?.auth).toMatchObject({ userId: 'service:ops', roles: ['service'] })
    expect(ctorArgs?.tenantId).toBe('madfam')
  })

  it('returns 202 { skipped } for an unresolvable subject (never a 500)', async () => {
    mockIngest.mockResolvedValueOnce({ status: 'skipped', reason: 'unresolved_contact' })
    const res = await POST(signedEvent(usageEvent))
    expect(res.status).toBe(202)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({ received: true, skipped: true, reason: 'unresolved_contact' })
  })

  it('reports a deduplicated replay with a 200', async () => {
    mockIngest.mockResolvedValueOnce({ status: 'duplicate', contactId: 'contact_1' })
    const res = await POST(signedEvent(usageEvent))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({ received: true, deduplicated: true, contact_id: 'contact_1' })
  })

  it('returns 500 when ingest throws', async () => {
    mockIngest.mockRejectedValueOnce(new Error('db down'))
    const res = await POST(signedEvent(usageEvent))
    expect(res.status).toBe(500)
  })
})

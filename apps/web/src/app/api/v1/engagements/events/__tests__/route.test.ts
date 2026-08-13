/**
 * /api/v1/engagements/events — unified engagement-event webhook.
 *
 * Contract verified:
 *   - 503 when PHYND_ENGAGEMENT_EVENTS_SECRET is unset (fail-closed)
 *   - modern `x-madfam-signature: t=<unix>,v1=<hex hmac-sha256 of "t.body">`
 *     accepted (#71) — the scheme nauta's emitEngagementEvent signs — with the
 *     validator's 5-minute replay window and no legacy downgrade path
 *   - legacy `x-webhook-signature` (plain hex HMAC of body + x-webhook-timestamp
 *     header) still accepted during the deprecation window for cotiza + dhanam
 *   - payloads missing engagement_id/source/event_type are dropped silently (no throw)
 *   - explicit dedup_key from caller is preserved
 *   - derived dedup_key shape when caller omits it: `<source>:<event_type>:<timestamp>`
 *   - source-scoped auth (service:<source>) passed to EngagementsService
 *   - Cotiza quote-lifecycle events are routed to CotizaQuoteLifecycleService
 *     (engagement_id optional): resolved → 200, unresolvable → 202 skip
 *
 * Signatures here are REAL HMACs verified by the real @phynd/federation
 * validators (no module mock) — same posture as the nauta webhook suite, so a
 * drift between signer and verifier fails the build instead of passing a mock.
 */
import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 99 })
vi.mock('@/lib/webhooks/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
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

// Vitest hoists `vi.mock` to the top of the file, so the factory closure
// can't reference top-level consts directly. Use vi.hoisted to share refs.
const { mockRecordEvent, EngagementsServiceMock, mockProcessWebhookPayload, CotizaServiceMock } =
  vi.hoisted(() => {
    const mockRecordEvent = vi.fn().mockResolvedValue({ deduplicated: false })
    const EngagementsServiceMock = vi.fn().mockImplementation(() => ({
      recordEvent: mockRecordEvent,
    }))
    const mockProcessWebhookPayload = vi.fn()
    const CotizaServiceMock = vi.fn().mockImplementation(() => ({
      processWebhookPayload: mockProcessWebhookPayload,
    }))
    return { mockRecordEvent, EngagementsServiceMock, mockProcessWebhookPayload, CotizaServiceMock }
  })

vi.mock('@phynd/services', () => ({
  EngagementsService: EngagementsServiceMock,
  CotizaQuoteLifecycleService: CotizaServiceMock,
  // Mirror the real detection predicate so routing between the generic and
  // Cotiza lifecycle paths behaves like production.
  isCotizaQuoteLifecycleEvent: (payload: Record<string, unknown>) =>
    payload.source === 'cotiza' &&
    typeof payload.event_type === 'string' &&
    /^(cotiza:)?quote_(sent|viewed|approved|rejected|expired|ordered)$/.test(payload.event_type),
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

// LEGACY scheme (deprecation window): plain hex HMAC of the body in
// x-webhook-signature + a separate x-webhook-timestamp header. This is what
// cotiza's phyndcrm-engagement.service and dhanam's
// phyndcrm-engagement-notifier.service still send today.
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

// MODERN ecosystem scheme (#71): x-madfam-signature: t=<unix>,v1=<hex> where
// v1 = hmac-sha256(secret, `${t}.${rawBody}`). Byte-exact mirror of nauta's
// signMadfamPayload — the producer this route's registration (#69) points at.
function createModernSignedRequest(
  body: object,
  options: { secret?: string; header?: string; timestamp?: number } = {},
) {
  const secret = options.secret ?? 'test-events-secret'
  const bodyStr = JSON.stringify(body)
  const ts = options.timestamp ?? Math.floor(Date.now() / 1000)
  const hmac = crypto.createHmac('sha256', secret).update(`${ts}.${bodyStr}`).digest('hex')
  return new Request('http://localhost/api/v1/engagements/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-madfam-signature': options.header ?? `t=${ts},v1=${hmac}`,
    },
    body: bodyStr,
  })
}

describe('POST /api/v1/engagements/events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PHYND_ENGAGEMENT_EVENTS_SECRET = 'test-events-secret'
    process.env.REDIS_URL = 'redis://localhost:6379'
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 99 })
    mockRecordEvent.mockResolvedValue({ deduplicated: false })
    mockProcessWebhookPayload.mockResolvedValue({
      outcome: 'recorded',
      engagementId: 'eng_1',
      contactId: 'contact_1',
      quoteId: 'quote_1',
      reflection: 'applied',
      autoMaterializedEngagement: false,
      createdQuote: false,
    })
  })

  afterEach(() => {
    delete process.env.PHYND_ENGAGEMENT_EVENTS_SECRET
    delete process.env.REDIS_URL
  })

  it('returns 503 when PHYND_ENGAGEMENT_EVENTS_SECRET is unset (fail-closed)', async () => {
    delete process.env.PHYND_ENGAGEMENT_EVENTS_SECRET
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
    // Signed with the wrong secret — the real validator must reject it.
    const req = createSignedRequest(
      {
        engagement_id: 'eng_1',
        source: 'dhanam',
        event_type: 'payment.succeeded',
      },
      { secret: 'not-the-configured-secret' },
    )
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
      source: 'selva',
      event_type: 'milestone_complete',
      timestamp: '2026-04-19T09:00:00.000Z',
      // dedup_key intentionally omitted
    }
    const req = createSignedRequest(payload)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const arg = getRecordedEventArg()
    // Shape of the derived key must be stable so a replay produces the same key.
    expect(arg.dedupKey).toBe('selva:milestone_complete:2026-04-19T09:00:00.000Z')
  })

  it('keeps non-lifecycle cotiza events on the generic path (engagement_id required)', async () => {
    const payload = {
      engagement_id: 'eng_1',
      source: 'cotiza',
      event_type: 'cotiza:proposal_revised',
      timestamp: '2026-04-19T09:00:00.000Z',
    }
    const req = createSignedRequest(payload)
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockRecordEvent).toHaveBeenCalledTimes(1)
    expect(mockProcessWebhookPayload).not.toHaveBeenCalled()
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

  describe('cotiza quote lifecycle path', () => {
    it('routes cotiza:quote_* events (no engagement_id) to CotizaQuoteLifecycleService', async () => {
      const payload = {
        source: 'cotiza',
        event_type: 'cotiza:quote_sent',
        dedup_key: 'cotiza:CQ-1:quote_sent',
        metadata: {
          cotiza_quote_id: 'CQ-1',
          quote_number: 'Q-2026-100',
          contact_email: 'client@acme.mx',
        },
      }
      const req = createSignedRequest(payload)
      const res = await POST(req)

      expect(res.status).toBe(200)
      expect(mockProcessWebhookPayload).toHaveBeenCalledTimes(1)
      expect(mockProcessWebhookPayload).toHaveBeenCalledWith(expect.objectContaining(payload))
      expect(mockRecordEvent).not.toHaveBeenCalled()

      const body = (await res.json()) as Record<string, unknown>
      expect(body).toMatchObject({
        received: true,
        deduplicated: false,
        engagement_id: 'eng_1',
        quote_id: 'quote_1',
        reflection: 'applied',
      })

      // Service context is cotiza-scoped.
      const ctorArgs = CotizaServiceMock.mock.calls.at(-1)?.[0]
      expect(ctorArgs?.auth).toMatchObject({ userId: 'service:cotiza', roles: ['service'] })
    })

    it('returns 202 { skipped } for unresolvable cotiza events (never a 500)', async () => {
      mockProcessWebhookPayload.mockResolvedValueOnce({
        outcome: 'skipped',
        reason: 'unresolved_contact',
      })
      const req = createSignedRequest({
        source: 'cotiza',
        event_type: 'cotiza:quote_viewed',
        metadata: { cotiza_quote_id: 'CQ-404', contact_email: 'nobody@nowhere.mx' },
      })
      const res = await POST(req)

      expect(res.status).toBe(202)
      const body = (await res.json()) as Record<string, unknown>
      expect(body).toMatchObject({ received: true, skipped: true, reason: 'unresolved_contact' })
    })

    it('reports deduplicated replays with a 200', async () => {
      mockProcessWebhookPayload.mockResolvedValueOnce({
        outcome: 'deduplicated',
        engagementId: 'eng_1',
        contactId: 'contact_1',
        quoteId: 'quote_1',
        reflection: 'noop',
        autoMaterializedEngagement: false,
        createdQuote: false,
      })
      const req = createSignedRequest({
        source: 'cotiza',
        event_type: 'cotiza:quote_approved',
        dedup_key: 'cotiza:CQ-1:quote_approved',
        metadata: { cotiza_quote_id: 'CQ-1' },
      })
      const res = await POST(req)

      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body).toMatchObject({ received: true, deduplicated: true })
    })

    it('returns 500 when lifecycle processing throws', async () => {
      mockProcessWebhookPayload.mockRejectedValueOnce(new Error('db down'))
      const req = createSignedRequest({
        source: 'cotiza',
        event_type: 'cotiza:quote_sent',
        metadata: { cotiza_quote_id: 'CQ-1' },
      })
      const res = await POST(req)
      expect(res.status).toBe(500)
    })
  })

  describe('modern x-madfam-signature scheme (#71)', () => {
    // The exact event N8 step C3 emits via nauta's emitEngagementEvent.
    const nautaPayload = {
      engagement_id: 'eng_nauta_ctm',
      source: 'nauta',
      event_type: 'nauta:qbr_published',
      status: 'completed',
      timestamp: '2026-08-12T09:00:00.000Z',
      dedup_key: 'nauta:qbr_published:2026-q3',
    }

    it('accepts t=<unix>,v1=<hmac of "t.body"> (nauta emitEngagementEvent contract)', async () => {
      const res = await POST(createModernSignedRequest(nautaPayload))
      expect(res.status).toBe(200)
      expect(mockRecordEvent).toHaveBeenCalledTimes(1)
      const arg = getRecordedEventArg()
      expect(arg).toMatchObject({
        engagementId: 'eng_nauta_ctm',
        source: 'nauta',
        eventType: 'nauta:qbr_published',
        dedupKey: 'nauta:qbr_published:2026-q3',
      })
    })

    it('rejects a garbage v1 digest with 401 and records nothing', async () => {
      const res = await POST(
        createModernSignedRequest(nautaPayload, {
          header: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
        }),
      )
      expect(res.status).toBe(401)
      expect(mockRecordEvent).not.toHaveBeenCalled()
    })

    it('rejects a tampered body — the HMAC covers "t.body" byte-exactly', async () => {
      const ts = Math.floor(Date.now() / 1000)
      const signedOver = JSON.stringify(nautaPayload)
      const hmac = crypto
        .createHmac('sha256', 'test-events-secret')
        .update(`${ts}.${signedOver}`)
        .digest('hex')
      const req = new Request('http://localhost/api/v1/engagements/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-madfam-signature': `t=${ts},v1=${hmac}`,
        },
        body: JSON.stringify({ ...nautaPayload, status: 'cancelled' }),
      })
      const res = await POST(req)
      expect(res.status).toBe(401)
      expect(mockRecordEvent).not.toHaveBeenCalled()
    })

    it('rejects a stale timestamp (>5 min old) even when the HMAC is valid', async () => {
      const res = await POST(
        createModernSignedRequest(nautaPayload, {
          timestamp: Math.floor(Date.now() / 1000) - 6 * 60,
        }),
      )
      expect(res.status).toBe(401)
      expect(mockRecordEvent).not.toHaveBeenCalled()
    })

    it('rejects a future timestamp outside the window (replay guard is symmetric)', async () => {
      const res = await POST(
        createModernSignedRequest(nautaPayload, {
          timestamp: Math.floor(Date.now() / 1000) + 6 * 60,
        }),
      )
      expect(res.status).toBe(401)
    })

    it('rejects a signature minted with the wrong secret', async () => {
      const res = await POST(createModernSignedRequest(nautaPayload, { secret: 'not-the-secret' }))
      expect(res.status).toBe(401)
    })

    it('fails closed with 503 when the secret is unset, before any verification', async () => {
      delete process.env.PHYND_ENGAGEMENT_EVENTS_SECRET
      const res = await POST(createModernSignedRequest(nautaPayload))
      expect(res.status).toBe(503)
      expect(mockRecordEvent).not.toHaveBeenCalled()
    })

    it('never downgrades: an invalid modern header 401s even with a valid legacy signature attached', async () => {
      const bodyStr = JSON.stringify(nautaPayload)
      const legacySig = crypto
        .createHmac('sha256', 'test-events-secret')
        .update(bodyStr)
        .digest('hex')
      const req = new Request('http://localhost/api/v1/engagements/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-madfam-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'f'.repeat(64)}`,
          'x-webhook-signature': legacySig,
          'x-webhook-timestamp': new Date().toISOString(),
        },
        body: bodyStr,
      })
      const res = await POST(req)
      expect(res.status).toBe(401)
      expect(mockRecordEvent).not.toHaveBeenCalled()
    })
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

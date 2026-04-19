import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type CotizaEngagementEvent,
  __resetEmitterWarningLatchForTests,
  dispatchCotizaEngagementEvent,
  emitCotizaEngagementEvent,
} from '../cotiza-engagement-emitter.service'

const SECRET = 'test-shared-secret-abc123'
const URL_BASE = 'https://api.cotiza.test'
const EXPECTED_URL = `${URL_BASE}/api/v1/webhooks/phynecrm/engagements`

function makeEvent(overrides: Partial<CotizaEngagementEvent> = {}): CotizaEngagementEvent {
  return {
    engagementId: 'eng-001',
    eventType: 'engagement.created',
    tenantId: 'madfam',
    data: {
      project_name: 'Tablaco Prototype',
      status: 'active',
      contact_id: 'contact-001',
    },
    ...overrides,
  }
}

describe('CotizaEngagementEmitter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    __resetEmitterWarningLatchForTests()
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('COTIZA_API_URL', URL_BASE)
    vi.stubEnv('PHYNECRM_OUTBOUND_SECRET', SECRET)
    vi.stubEnv('COTIZA_WEBHOOK_TIMEOUT', '5000')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('emitCotizaEngagementEvent', () => {
    it('POSTs to the Cotiza webhook receiver URL', async () => {
      await emitCotizaEngagementEvent(makeEvent())

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] ?? []
      expect(url).toBe(EXPECTED_URL)
      expect(init?.method).toBe('POST')
      expect(init?.headers?.['Content-Type']).toBe('application/json')
    })

    it('signs the body with HMAC-SHA256 using the outbound secret', async () => {
      await emitCotizaEngagementEvent(makeEvent())

      const init = fetchMock.mock.calls[0]?.[1]
      const body = init?.body as string
      const signature = init?.headers?.['x-phynecrm-signature'] as string
      const expected = crypto.createHmac('sha256', SECRET).update(body).digest('hex')

      expect(signature).toBe(expected)
      expect(signature).toMatch(/^[0-9a-f]{64}$/)
    })

    it('serializes payload with snake_case keys matching Cotiza controller', async () => {
      await emitCotizaEngagementEvent(makeEvent())

      const init = fetchMock.mock.calls[0]?.[1]
      const parsed = JSON.parse(init?.body as string)
      expect(parsed.engagement_id).toBe('eng-001')
      expect(parsed.event_type).toBe('engagement.created')
      expect(parsed.tenant_id).toBe('madfam')
      expect(typeof parsed.timestamp).toBe('string')
      expect(Number.isNaN(Date.parse(parsed.timestamp))).toBe(false)
      expect(parsed.data.project_name).toBe('Tablaco Prototype')
      expect(parsed.data.contact_id).toBe('contact-001')
    })

    it.each<CotizaEngagementEvent['eventType']>([
      'engagement.created',
      'engagement.updated',
      'engagement.archived',
    ])('dispatches event_type=%s correctly', async (eventType) => {
      await emitCotizaEngagementEvent(makeEvent({ eventType }))

      const init = fetchMock.mock.calls[0]?.[1]
      const parsed = JSON.parse(init?.body as string)
      expect(parsed.event_type).toBe(eventType)
    })

    it('skips dispatch and does not call fetch when COTIZA_API_URL is unset', async () => {
      vi.stubEnv('COTIZA_API_URL', '')

      await emitCotizaEngagementEvent(makeEvent())

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('skips dispatch and does not call fetch when PHYNECRM_OUTBOUND_SECRET is unset', async () => {
      vi.stubEnv('PHYNECRM_OUTBOUND_SECRET', '')

      await emitCotizaEngagementEvent(makeEvent())

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('swallows fetch rejections (fire-and-forget safety)', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      await expect(emitCotizaEngagementEvent(makeEvent())).resolves.toBeUndefined()
    })

    it('does not throw on non-2xx responses (logs and returns)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'internal server error',
      })

      await expect(emitCotizaEngagementEvent(makeEvent())).resolves.toBeUndefined()
    })

    it('strips trailing slash from COTIZA_API_URL', async () => {
      vi.stubEnv('COTIZA_API_URL', `${URL_BASE}/`)

      await emitCotizaEngagementEvent(makeEvent())

      const [url] = fetchMock.mock.calls[0] ?? []
      expect(url).toBe(EXPECTED_URL)
    })

    it('does not add extra dedup logic — idempotency is the receivers responsibility', async () => {
      // Call same event twice — emitter should send twice (no local dedup).
      // Receiver enforces idempotency on engagement_id + event_type.
      await emitCotizaEngagementEvent(makeEvent())
      await emitCotizaEngagementEvent(makeEvent())

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('passes an AbortSignal driven by COTIZA_WEBHOOK_TIMEOUT', async () => {
      await emitCotizaEngagementEvent(makeEvent())

      const init = fetchMock.mock.calls[0]?.[1]
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    })
  })

  describe('dispatchCotizaEngagementEvent (fire-and-forget)', () => {
    it('returns synchronously (void) and schedules the HTTP call async', async () => {
      const result = dispatchCotizaEngagementEvent(makeEvent())

      // Synchronous return, not a Promise
      expect(result).toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()

      // Drain microtasks + setImmediate
      await new Promise((resolve) => setImmediate(resolve))

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does not surface errors when fetch rejects', async () => {
      fetchMock.mockRejectedValueOnce(new Error('timeout'))

      expect(() => dispatchCotizaEngagementEvent(makeEvent())).not.toThrow()

      await new Promise((resolve) => setImmediate(resolve))
      // Give the swallowed promise a chance to resolve
      await new Promise((resolve) => setImmediate(resolve))
    })
  })
})

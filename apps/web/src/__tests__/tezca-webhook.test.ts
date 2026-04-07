import { afterEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock all heavy dependencies before importing the route
// ---------------------------------------------------------------------------
const mockHandleWebhook = vi.fn()
vi.mock('@/lib/webhooks/handler', () => ({
  handleWebhook: (...args: unknown[]) => mockHandleWebhook(...args),
}))

vi.mock('@/lib/federation/clients', () => ({
  getCacheManager: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    invalidate: vi.fn(),
  })),
}))

vi.mock('@phyne/db', () => ({
  getDb: vi.fn(() => ({})),
}))

vi.mock('@phyne/logging', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

const mockProcessWebhook = vi.fn()
vi.mock('@phyne/services', () => {
  // Use a real class so `new RedditBotService()` returns an instance with methods
  class MockRedditBotService {
    processWebhook = mockProcessWebhook
  }
  return {
    RedditBotService: MockRedditBotService,
    createServiceContext: vi.fn(() => ({})),
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/webhooks/tezca', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    mockProcessWebhook.mockReset()
  })

  it('returns 503 when TEZCA_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.TEZCA_WEBHOOK_SECRET

    const { POST } = await import('@/app/api/webhooks/tezca/route')
    const req = new Request('http://localhost/api/webhooks/tezca', { method: 'POST' })
    const res = await POST(req)

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('Webhook secret not configured')
  })

  it('delegates to handleWebhook when secret is configured', async () => {
    vi.stubEnv('TEZCA_WEBHOOK_SECRET', 'test-secret-abc')

    const mockResponse = new Response(JSON.stringify({ received: true }), { status: 200 })
    mockHandleWebhook.mockResolvedValueOnce(mockResponse)

    const { POST } = await import('@/app/api/webhooks/tezca/route')
    const req = new Request('http://localhost/api/webhooks/tezca', {
      method: 'POST',
      body: JSON.stringify({ type: 'interest.created', data: {} }),
    })
    const res = await POST(req)

    expect(mockHandleWebhook).toHaveBeenCalledWith(req, expect.objectContaining({
      secret: 'test-secret-abc',
      onEvent: expect.any(Function),
    }))
    expect(res.status).toBe(200)
  })

  it('onEvent ignores non-interest.created events', async () => {
    vi.stubEnv('TEZCA_WEBHOOK_SECRET', 'test-secret-abc')

    let capturedOnEvent: ((raw: unknown) => Promise<void>) | undefined
    mockHandleWebhook.mockImplementationOnce((_req: unknown, options: { onEvent: (raw: unknown) => Promise<void> }) => {
      capturedOnEvent = options.onEvent
      return new Response(JSON.stringify({ received: true }), { status: 200 })
    })

    const { POST } = await import('@/app/api/webhooks/tezca/route')
    const req = new Request('http://localhost/api/webhooks/tezca', { method: 'POST' })
    await POST(req)

    await capturedOnEvent!({ type: 'other.event', data: {} })

    expect(mockProcessWebhook).not.toHaveBeenCalled()
  })

  it('onEvent skips malformed payloads missing required fields', async () => {
    vi.stubEnv('TEZCA_WEBHOOK_SECRET', 'test-secret-abc')

    let capturedOnEvent: ((raw: unknown) => Promise<void>) | undefined
    mockHandleWebhook.mockImplementationOnce((_req: unknown, options: { onEvent: (raw: unknown) => Promise<void> }) => {
      capturedOnEvent = options.onEvent
      return new Response(JSON.stringify({ received: true }), { status: 200 })
    })

    const { POST } = await import('@/app/api/webhooks/tezca/route')
    const req = new Request('http://localhost/api/webhooks/tezca', { method: 'POST' })
    await POST(req)

    // Missing outreach_target.url
    await capturedOnEvent!({
      type: 'interest.created',
      data: {
        outreach_target: { author: 'test' },
        legal_context: {},
      },
    })

    expect(mockProcessWebhook).not.toHaveBeenCalled()
  })

  it('onEvent processes valid interest.created payloads', async () => {
    vi.stubEnv('TEZCA_WEBHOOK_SECRET', 'test-secret-abc')

    let capturedOnEvent: ((raw: unknown) => Promise<void>) | undefined
    mockHandleWebhook.mockImplementationOnce((_req: unknown, options: { onEvent: (raw: unknown) => Promise<void> }) => {
      capturedOnEvent = options.onEvent
      return new Response(JSON.stringify({ received: true }), { status: 200 })
    })

    mockProcessWebhook.mockResolvedValueOnce({
      status: 'success',
      draft_stage_id: 'campaign-001',
      contactId: 'contact-001',
    })

    const { POST } = await import('@/app/api/webhooks/tezca/route')
    const req = new Request('http://localhost/api/webhooks/tezca', { method: 'POST' })
    await POST(req)

    const validPayload = {
      type: 'interest.created',
      data: {
        campaign_type: 'legal_outreach',
        bot_identity: 'MadfamBot',
        outreach_target: {
          url: 'https://reddit.com/r/test/comments/abc/post/',
          author: 'testuser',
          original_post_content: 'Me despidieron...',
        },
        legal_context: {
          distress_sentiment: 'high',
          core_legal_problem: 'despido injustificado',
          domain: 'labor',
        },
        orchestration: { instruction: 'Respond' },
      },
    }

    await capturedOnEvent!(validPayload)

    expect(mockProcessWebhook).toHaveBeenCalledWith(validPayload.data)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock heavy dependencies
// ---------------------------------------------------------------------------
vi.mock('@phyne/db', () => ({
  getDb: vi.fn(() => ({})),
}))

vi.mock('@/lib/federation/clients', () => ({
  getCacheManager: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    invalidate: vi.fn(),
  })),
}))

const mockProcessWebhook = vi.fn()
vi.mock('@phyne/services', () => {
  class MockRedditBotService {
    processWebhook = mockProcessWebhook
  }
  return {
    RedditBotService: MockRedditBotService,
    createServiceContext: vi.fn(() => ({})),
  }
})

// ---------------------------------------------------------------------------
// Tests — auth hardening for POST /api/campaigns/trigger
// ---------------------------------------------------------------------------
describe('POST /api/campaigns/trigger — auth hardening', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    mockProcessWebhook.mockReset()
  })

  it('returns 503 when FORTUNA_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.FORTUNA_WEBHOOK_SECRET

    const { POST } = await import('@/app/api/campaigns/trigger/route')
    const req = new Request('http://localhost/api/campaigns/trigger', {
      method: 'POST',
      headers: { Authorization: 'Bearer some-token' },
    })

    const res = await POST(req)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain('webhook secret not configured')
  })

  it('returns 401 when Authorization header is missing', async () => {
    vi.stubEnv('FORTUNA_WEBHOOK_SECRET', 'super-secret-token-16chars')

    const { POST } = await import('@/app/api/campaigns/trigger/route')
    const req = new Request('http://localhost/api/campaigns/trigger', {
      method: 'POST',
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized webhook trigger')
  })

  it('returns 401 when Authorization header has wrong secret', async () => {
    vi.stubEnv('FORTUNA_WEBHOOK_SECRET', 'super-secret-token-16chars')

    const { POST } = await import('@/app/api/campaigns/trigger/route')
    const req = new Request('http://localhost/api/campaigns/trigger', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret' },
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when Authorization header uses wrong scheme', async () => {
    vi.stubEnv('FORTUNA_WEBHOOK_SECRET', 'super-secret-token-16chars')

    const { POST } = await import('@/app/api/campaigns/trigger/route')
    const req = new Request('http://localhost/api/campaigns/trigger', {
      method: 'POST',
      headers: { Authorization: 'Basic super-secret-token-16chars' },
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('accepts valid Bearer token and dispatches to RedditBotService', async () => {
    const secret = 'super-secret-token-16chars'
    vi.stubEnv('FORTUNA_WEBHOOK_SECRET', secret)

    mockProcessWebhook.mockResolvedValueOnce({
      status: 'success',
      draft_stage_id: 'campaign-001',
    })

    const { POST } = await import('@/app/api/campaigns/trigger/route')
    const payload = {
      campaign_type: 'legal_outreach',
      bot_identity: 'MadfamBot',
      outreach_target: { url: 'https://reddit.com/r/test/abc', author: 'user1', original_post_content: 'Test' },
      legal_context: { distress_sentiment: 'medium', core_legal_problem: 'test', domain: 'civil' },
      orchestration: { instruction: 'Respond' },
    }

    const req = new Request('http://localhost/api/campaigns/trigger', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('success')
    expect(mockProcessWebhook).toHaveBeenCalledWith(payload)
  })

  it('returns 500 when processWebhook throws', async () => {
    const secret = 'super-secret-token-16chars'
    vi.stubEnv('FORTUNA_WEBHOOK_SECRET', secret)

    mockProcessWebhook.mockRejectedValueOnce(new Error('Tezca offline'))

    const { POST } = await import('@/app/api/campaigns/trigger/route')
    const req = new Request('http://localhost/api/campaigns/trigger', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ test: true }),
    })

    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('Internal Server Error')
  })

  it('does not accept the old hardcoded token', async () => {
    vi.stubEnv('FORTUNA_WEBHOOK_SECRET', 'new-production-secret-value')

    const { POST } = await import('@/app/api/campaigns/trigger/route')
    const req = new Request('http://localhost/api/campaigns/trigger', {
      method: 'POST',
      headers: { Authorization: 'Bearer internal-secret-token' },
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})

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

const mockQueueAdd = vi.fn()
const mockQueueClose = vi.fn()
vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    add = (...args: unknown[]) => mockQueueAdd(...args)
    close = (...args: unknown[]) => mockQueueClose(...args)
  },
}))

const mockProcessWebhook = vi.fn()
const mockGetByEmail = vi.fn()
const mockContactCreate = vi.fn()
const mockLeadCreate = vi.fn()
const mockGetDefault = vi.fn()
const mockGetStages = vi.fn()

vi.mock('@phyne/services', () => {
  // Use a real class so `new RedditBotService()` returns an instance with methods
  class MockRedditBotService {
    processWebhook = mockProcessWebhook
  }
  class MockContactsService {
    getByEmail = mockGetByEmail
    create = mockContactCreate
  }
  class MockLeadsService {
    create = mockLeadCreate
  }
  class MockPipelinesService {
    getDefault = mockGetDefault
    getStages = mockGetStages
  }
  return {
    ContactsService: MockContactsService,
    LeadsService: MockLeadsService,
    PipelinesService: MockPipelinesService,
    RedditBotService: MockRedditBotService,
    createServiceContext: vi.fn(() => ({})),
  }
})

// ---------------------------------------------------------------------------
// Helper: capture the onEvent callback from handleWebhook
// ---------------------------------------------------------------------------
function setupOnEventCapture() {
  let capturedOnEvent: ((raw: unknown) => Promise<void>) | undefined
  mockHandleWebhook.mockImplementationOnce((_req: unknown, options: { onEvent: (raw: unknown) => Promise<void> }) => {
    capturedOnEvent = options.onEvent
    return new Response(JSON.stringify({ received: true }), { status: 200 })
  })
  return {
    getCapturedOnEvent: () => capturedOnEvent!,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/webhooks/tezca', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    mockProcessWebhook.mockReset()
    mockGetByEmail.mockReset()
    mockContactCreate.mockReset()
    mockLeadCreate.mockReset()
    mockGetDefault.mockReset()
    mockGetStages.mockReset()
    mockQueueAdd.mockReset()
    mockQueueClose.mockReset()
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

    const { getCapturedOnEvent } = setupOnEventCapture()

    const { POST } = await import('@/app/api/webhooks/tezca/route')
    const req = new Request('http://localhost/api/webhooks/tezca', { method: 'POST' })
    await POST(req)

    await getCapturedOnEvent()({ type: 'other.event', data: {} })

    expect(mockProcessWebhook).not.toHaveBeenCalled()
    expect(mockGetByEmail).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Branch 0: Newsletter subscription (newsletter.subscribed)
  // -------------------------------------------------------------------------
  describe('Newsletter subscription payload', () => {
    const newsletterPayload = {
      type: 'newsletter.subscribed',
      data: {
        email: 'subscriber@example.com',
        topics: ['labor'],
        source_page: 'bienvenida',
      },
    }

    it('creates contact and lead for newsletter subscription', async () => {
      vi.stubEnv('TEZCA_WEBHOOK_SECRET', 'test-secret-abc')
      const { getCapturedOnEvent } = setupOnEventCapture()

      const { POST } = await import('@/app/api/webhooks/tezca/route')
      const req = new Request('http://localhost/api/webhooks/tezca', { method: 'POST' })
      await POST(req)

      mockGetByEmail.mockResolvedValueOnce(null)
      mockContactCreate.mockResolvedValueOnce({ id: 'contact-news', name: 'subscriber', email: 'subscriber@example.com' })
      mockGetDefault.mockResolvedValueOnce({ id: 'pipeline-001' })
      mockGetStages.mockResolvedValueOnce([{ id: 'stage-001', position: 0 }])
      mockLeadCreate.mockResolvedValueOnce({ id: 'lead-news' })
      mockQueueAdd.mockResolvedValueOnce({})
      mockQueueClose.mockResolvedValueOnce(undefined)

      await getCapturedOnEvent()(newsletterPayload)

      expect(mockGetByEmail).toHaveBeenCalledWith('subscriber@example.com')
      expect(mockContactCreate).toHaveBeenCalledWith(expect.objectContaining({
        name: 'subscriber',
        email: 'subscriber@example.com',
      }))
      expect(mockLeadCreate).toHaveBeenCalledWith(expect.objectContaining({
        contactId: 'contact-news',
        source: 'tezca_newsletter',
        pipelineId: 'pipeline-001',
        stageId: 'stage-001',
      }))
      // Should NOT call RedditBotService
      expect(mockProcessWebhook).not.toHaveBeenCalled()
    })

    it('enqueues email drip after lead creation', async () => {
      vi.stubEnv('TEZCA_WEBHOOK_SECRET', 'test-secret-abc')
      const { getCapturedOnEvent } = setupOnEventCapture()

      const { POST } = await import('@/app/api/webhooks/tezca/route')
      const req = new Request('http://localhost/api/webhooks/tezca', { method: 'POST' })
      await POST(req)

      mockGetByEmail.mockResolvedValueOnce(null)
      mockContactCreate.mockResolvedValueOnce({ id: 'contact-news', name: 'subscriber', email: 'subscriber@example.com' })
      mockGetDefault.mockResolvedValueOnce({ id: 'pipeline-001' })
      mockGetStages.mockResolvedValueOnce([{ id: 'stage-001', position: 0 }])
      mockLeadCreate.mockResolvedValueOnce({ id: 'lead-drip-test' })
      mockQueueAdd.mockResolvedValueOnce({})
      mockQueueClose.mockResolvedValueOnce(undefined)

      await getCapturedOnEvent()(newsletterPayload)

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'drip',
        { leadId: 'lead-drip-test', step: 0 },
        expect.objectContaining({ delay: 0 }),
      )
    })

    it('reuses existing contact for newsletter subscription', async () => {
      vi.stubEnv('TEZCA_WEBHOOK_SECRET', 'test-secret-abc')
      const { getCapturedOnEvent } = setupOnEventCapture()

      const { POST } = await import('@/app/api/webhooks/tezca/route')
      const req = new Request('http://localhost/api/webhooks/tezca', { method: 'POST' })
      await POST(req)

      mockGetByEmail.mockResolvedValueOnce({ id: 'contact-existing', name: 'subscriber', email: 'subscriber@example.com' })
      mockGetDefault.mockResolvedValueOnce({ id: 'pipeline-001' })
      mockGetStages.mockResolvedValueOnce([{ id: 'stage-001', position: 0 }])
      mockLeadCreate.mockResolvedValueOnce({ id: 'lead-reuse' })
      mockQueueAdd.mockResolvedValueOnce({})
      mockQueueClose.mockResolvedValueOnce(undefined)

      await getCapturedOnEvent()(newsletterPayload)

      expect(mockContactCreate).not.toHaveBeenCalled()
      expect(mockLeadCreate).toHaveBeenCalledWith(expect.objectContaining({
        contactId: 'contact-existing',
        source: 'tezca_newsletter',
      }))
    })
  })

  // -------------------------------------------------------------------------
  // Branch 1: Tezca interest payloads (email + feature_key)
  // -------------------------------------------------------------------------
  describe('Tezca interest payload (email + feature_key)', () => {
    const tezcaInterestPayload = {
      type: 'interest.created',
      data: {
        email: 'prospect@example.com',
        feature_key: 'semantic_search',
        use_case: 'Legal research',
        janua_user_id: 'janua-abc',
      },
    }

    it('creates contact and lead for new email', async () => {
      vi.stubEnv('TEZCA_WEBHOOK_SECRET', 'test-secret-abc')
      const { getCapturedOnEvent } = setupOnEventCapture()

      const { POST } = await import('@/app/api/webhooks/tezca/route')
      const req = new Request('http://localhost/api/webhooks/tezca', { method: 'POST' })
      await POST(req)

      // No existing contact
      mockGetByEmail.mockResolvedValueOnce(null)
      // Contact created
      mockContactCreate.mockResolvedValueOnce({ id: 'contact-new', name: 'prospect', email: 'prospect@example.com' })
      // Pipeline + stages for lead creation
      mockGetDefault.mockResolvedValueOnce({ id: 'pipeline-001' })
      mockGetStages.mockResolvedValueOnce([{ id: 'stage-001', position: 0 }])
      mockLeadCreate.mockResolvedValueOnce({ id: 'lead-001' })
      mockQueueAdd.mockResolvedValueOnce({})
      mockQueueClose.mockResolvedValueOnce(undefined)

      await getCapturedOnEvent()(tezcaInterestPayload)

      // Should look up contact by email
      expect(mockGetByEmail).toHaveBeenCalledWith('prospect@example.com')
      // Should create contact since none found
      expect(mockContactCreate).toHaveBeenCalledWith(expect.objectContaining({
        name: 'prospect',
        email: 'prospect@example.com',
        externalJanuaId: 'janua-abc',
      }))
      // Should create lead in default pipeline
      expect(mockLeadCreate).toHaveBeenCalledWith(expect.objectContaining({
        contactId: 'contact-new',
        source: 'tezca_interest:semantic_search',
        pipelineId: 'pipeline-001',
        stageId: 'stage-001',
      }))
      // Should NOT call RedditBotService
      expect(mockProcessWebhook).not.toHaveBeenCalled()
    })

    it('skips contact creation when existing contact found by email', async () => {
      vi.stubEnv('TEZCA_WEBHOOK_SECRET', 'test-secret-abc')
      const { getCapturedOnEvent } = setupOnEventCapture()

      const { POST } = await import('@/app/api/webhooks/tezca/route')
      const req = new Request('http://localhost/api/webhooks/tezca', { method: 'POST' })
      await POST(req)

      // Existing contact found
      mockGetByEmail.mockResolvedValueOnce({ id: 'contact-existing', name: 'prospect', email: 'prospect@example.com' })
      // Pipeline + stages for lead creation
      mockGetDefault.mockResolvedValueOnce({ id: 'pipeline-001' })
      mockGetStages.mockResolvedValueOnce([{ id: 'stage-001', position: 0 }])
      mockLeadCreate.mockResolvedValueOnce({ id: 'lead-002' })
      mockQueueAdd.mockResolvedValueOnce({})
      mockQueueClose.mockResolvedValueOnce(undefined)

      await getCapturedOnEvent()(tezcaInterestPayload)

      // Should look up contact by email
      expect(mockGetByEmail).toHaveBeenCalledWith('prospect@example.com')
      // Should NOT create a new contact
      expect(mockContactCreate).not.toHaveBeenCalled()
      // Should still create lead with existing contact
      expect(mockLeadCreate).toHaveBeenCalledWith(expect.objectContaining({
        contactId: 'contact-existing',
        source: 'tezca_interest:semantic_search',
      }))
    })

    it('handles missing default pipeline gracefully (no lead created)', async () => {
      vi.stubEnv('TEZCA_WEBHOOK_SECRET', 'test-secret-abc')
      const { getCapturedOnEvent } = setupOnEventCapture()

      const { POST } = await import('@/app/api/webhooks/tezca/route')
      const req = new Request('http://localhost/api/webhooks/tezca', { method: 'POST' })
      await POST(req)

      mockGetByEmail.mockResolvedValueOnce(null)
      mockContactCreate.mockResolvedValueOnce({ id: 'contact-new', name: 'prospect', email: 'prospect@example.com' })
      // No default pipeline
      mockGetDefault.mockResolvedValueOnce(null)

      // Should not throw — the route handles missing pipeline gracefully
      await getCapturedOnEvent()(tezcaInterestPayload)

      expect(mockContactCreate).toHaveBeenCalled()
      expect(mockLeadCreate).not.toHaveBeenCalled()
    })

    it('derives contact name from email prefix when no janua_user_id', async () => {
      vi.stubEnv('TEZCA_WEBHOOK_SECRET', 'test-secret-abc')
      const { getCapturedOnEvent } = setupOnEventCapture()

      const { POST } = await import('@/app/api/webhooks/tezca/route')
      const req = new Request('http://localhost/api/webhooks/tezca', { method: 'POST' })
      await POST(req)

      mockGetByEmail.mockResolvedValueOnce(null)
      mockContactCreate.mockResolvedValueOnce({ id: 'contact-new', name: 'alice', email: 'alice@corp.com' })
      mockGetDefault.mockResolvedValueOnce(null)

      const payloadWithoutJanua = {
        type: 'interest.created',
        data: {
          email: 'alice@corp.com',
          feature_key: 'analytics',
        },
      }

      await getCapturedOnEvent()(payloadWithoutJanua)

      // Name derived from email prefix, no externalJanuaId set
      expect(mockContactCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'alice',
          email: 'alice@corp.com',
        }),
      )
      // Should not include externalJanuaId key when janua_user_id is absent
      const createArg = mockContactCreate.mock.calls[0]?.[0] as Record<string, unknown>
      expect(createArg).not.toHaveProperty('externalJanuaId')
    })
  })

  // -------------------------------------------------------------------------
  // Branch 2: Reddit bot payloads (outreach_target + legal_context)
  // -------------------------------------------------------------------------
  describe('Reddit bot payload (outreach_target + legal_context)', () => {
    it('routes valid Reddit payloads through RedditBotService', async () => {
      vi.stubEnv('TEZCA_WEBHOOK_SECRET', 'test-secret-abc')
      const { getCapturedOnEvent } = setupOnEventCapture()

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

      await getCapturedOnEvent()(validPayload)

      expect(mockProcessWebhook).toHaveBeenCalledWith(validPayload.data)
      // Should NOT use ContactsService directly (RedditBotService handles it)
      expect(mockGetByEmail).not.toHaveBeenCalled()
    })

    it('skips malformed Reddit payloads missing outreach_target.url', async () => {
      vi.stubEnv('TEZCA_WEBHOOK_SECRET', 'test-secret-abc')
      const { getCapturedOnEvent } = setupOnEventCapture()

      const { POST } = await import('@/app/api/webhooks/tezca/route')
      const req = new Request('http://localhost/api/webhooks/tezca', { method: 'POST' })
      await POST(req)

      await getCapturedOnEvent()({
        type: 'interest.created',
        data: {
          outreach_target: { author: 'test', url: '' },
          legal_context: { core_legal_problem: '', domain: 'labor' },
        },
      })

      expect(mockProcessWebhook).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Unrecognized payloads
  // -------------------------------------------------------------------------
  describe('unrecognized payload shape', () => {
    it('logs and skips payloads that match neither branch', async () => {
      vi.stubEnv('TEZCA_WEBHOOK_SECRET', 'test-secret-abc')
      const { getCapturedOnEvent } = setupOnEventCapture()

      const { POST } = await import('@/app/api/webhooks/tezca/route')
      const req = new Request('http://localhost/api/webhooks/tezca', { method: 'POST' })
      await POST(req)

      // Payload with neither email+feature_key nor outreach_target+legal_context
      await getCapturedOnEvent()({
        type: 'interest.created',
        data: {
          some_unknown_field: 'value',
          another_field: 42,
        },
      })

      // Neither branch should have been entered
      expect(mockProcessWebhook).not.toHaveBeenCalled()
      expect(mockGetByEmail).not.toHaveBeenCalled()
      expect(mockContactCreate).not.toHaveBeenCalled()
    })

    it('skips when data is missing entirely', async () => {
      vi.stubEnv('TEZCA_WEBHOOK_SECRET', 'test-secret-abc')
      const { getCapturedOnEvent } = setupOnEventCapture()

      const { POST } = await import('@/app/api/webhooks/tezca/route')
      const req = new Request('http://localhost/api/webhooks/tezca', { method: 'POST' })
      await POST(req)

      await getCapturedOnEvent()({
        type: 'interest.created',
        // no data field
      })

      expect(mockProcessWebhook).not.toHaveBeenCalled()
      expect(mockGetByEmail).not.toHaveBeenCalled()
    })
  })
})

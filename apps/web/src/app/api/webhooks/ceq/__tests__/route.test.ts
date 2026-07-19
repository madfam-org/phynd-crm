import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// ceq is the inbound conversion webhook that resolves a paid campaign from
// utm_campaign. Attribution threading (RFC 0035 P4) adds the finer signal-level
// key — fortuna_signal_id (carried by utm_content / insight_id) — into the
// conversion metadata, closing fortuna insight -> consent -> conversion. These
// tests pin that read path and confirm utm_campaign stays the resolver.
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

vi.mock('@phynd/db', () => ({
  getDb: vi.fn(() => ({})),
}))

vi.mock('@phynd/config/connections', () => ({
  resolveRedisUrl: () => 'redis://localhost:6379',
}))

vi.mock('@phynd/config/constants', () => ({
  DEFAULT_TENANT_ID: 'madfam',
}))

vi.mock('@phynd/logging', () => ({
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

const mockGetByEmail = vi.fn()
const mockContactCreate = vi.fn()
const mockLeadCreate = vi.fn()
const mockGetDefault = vi.fn()
const mockGetStages = vi.fn()
const mockGetByUtmCampaign = vi.fn()
const mockRecordConversion = vi.fn()

vi.mock('@phynd/services', () => {
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
  class MockCampaignsService {
    getByUtmCampaign = mockGetByUtmCampaign
  }
  class MockConversionsService {
    recordConversion = mockRecordConversion
  }
  return {
    ContactsService: MockContactsService,
    LeadsService: MockLeadsService,
    PipelinesService: MockPipelinesService,
    CampaignsService: MockCampaignsService,
    ConversionsService: MockConversionsService,
    createServiceContext: vi.fn(() => ({})),
  }
})

// Capture the onEvent callback handed to handleWebhook so we can drive it.
function setupOnEventCapture() {
  let capturedOnEvent: ((raw: unknown) => Promise<void>) | undefined
  mockHandleWebhook.mockImplementationOnce(
    (_req: unknown, options: { onEvent: (raw: unknown) => Promise<void> }) => {
      capturedOnEvent = options.onEvent
      return new Response(JSON.stringify({ received: true }), { status: 200 })
    },
  )
  return {
    getCapturedOnEvent: () => {
      if (!capturedOnEvent) {
        throw new Error('Expected handleWebhook onEvent callback to be captured')
      }
      return capturedOnEvent
    },
  }
}

async function drive(payload: unknown) {
  const { getCapturedOnEvent } = setupOnEventCapture()
  const { POST } = await import('@/app/api/webhooks/ceq/route')
  await POST(new Request('http://localhost/api/webhooks/ceq', { method: 'POST' }))
  await getCapturedOnEvent()(payload)
}

function primeHappyPath() {
  mockGetByEmail.mockResolvedValueOnce(null)
  mockContactCreate.mockResolvedValueOnce({ id: 'contact-1', email: 'prospect@example.com' })
  mockGetDefault.mockResolvedValueOnce({ id: 'pipeline-1' })
  mockGetStages.mockResolvedValueOnce([{ id: 'stage-1', position: 0 }])
  mockLeadCreate.mockResolvedValueOnce({ id: 'lead-1' })
  mockGetByUtmCampaign.mockResolvedValueOnce({ id: 'campaign-1' })
  mockRecordConversion.mockResolvedValueOnce({ id: 'conv-1' })
}

describe('POST /api/webhooks/ceq — conversion attribution read path', () => {
  beforeEach(() => {
    vi.stubEnv('CEQ_WEBHOOK_SECRET', 'test-secret-abc')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    for (const m of [
      mockGetByEmail,
      mockContactCreate,
      mockLeadCreate,
      mockGetDefault,
      mockGetStages,
      mockGetByUtmCampaign,
      mockRecordConversion,
      mockQueueAdd,
      mockQueueClose,
    ]) {
      m.mockReset()
    }
  })

  it('records fortuna_signal_id + utm_content into the conversion metadata', async () => {
    primeHappyPath()

    await drive({
      type: 'interest.created',
      data: {
        email: 'prospect@example.com',
        feature_key: 'render_3d',
        utm_source: 'fortuna',
        utm_medium: 'insight',
        utm_campaign: 'peso-goldilocks',
        utm_content: 'sig_ceq_abc123def456',
        insight_id: 'sig_ceq_abc123def456',
      },
    })

    // utm_campaign stays the campaign resolver.
    expect(mockGetByUtmCampaign).toHaveBeenCalledWith('peso-goldilocks')
    expect(mockRecordConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'paid_lead',
        campaignId: 'campaign-1',
        metadata: expect.objectContaining({
          utm_campaign: 'peso-goldilocks',
          utm_content: 'sig_ceq_abc123def456',
          fortuna_signal_id: 'sig_ceq_abc123def456',
        }),
      }),
    )
  })

  it('falls back to utm_content for fortuna_signal_id when insight_id is absent', async () => {
    primeHappyPath()

    await drive({
      type: 'interest.created',
      data: {
        email: 'prospect@example.com',
        feature_key: 'render_3d',
        utm_campaign: 'peso-goldilocks',
        utm_content: 'sig_ceq_deadbeef0000',
      },
    })

    const metadata = mockRecordConversion.mock.calls[0]?.[0]?.metadata as Record<string, unknown>
    expect(metadata.fortuna_signal_id).toBe('sig_ceq_deadbeef0000')
  })

  it('does not attribute (or record fortuna_signal_id) when utm_campaign is absent', async () => {
    mockGetByEmail.mockResolvedValueOnce(null)
    mockContactCreate.mockResolvedValueOnce({ id: 'contact-1', email: 'prospect@example.com' })
    mockGetDefault.mockResolvedValueOnce({ id: 'pipeline-1' })
    mockGetStages.mockResolvedValueOnce([{ id: 'stage-1', position: 0 }])
    mockLeadCreate.mockResolvedValueOnce({ id: 'lead-1' })

    await drive({
      type: 'interest.created',
      data: {
        email: 'prospect@example.com',
        feature_key: 'render_3d',
        insight_id: 'sig_ceq_abc123def456',
      },
    })

    expect(mockGetByUtmCampaign).not.toHaveBeenCalled()
    expect(mockRecordConversion).not.toHaveBeenCalled()
  })
})

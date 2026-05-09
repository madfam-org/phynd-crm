import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type MockDatabase,
  createTestContext,
  makeCampaign,
  makeContact,
  makeLead,
  makePipeline,
  makePipelineStage,
} from './helpers'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  asc: vi.fn((col: unknown) => ({ _tag: 'asc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
  sql: vi.fn(),
}))

vi.mock('@phynd/db/schema', () => ({
  campaigns: { id: 'campaigns.id', status: 'campaigns.status' },
  contacts: {
    deletedAt: 'contacts.deletedAt',
    email: 'contacts.email',
    externalJanuaId: 'contacts.externalJanuaId',
    id: 'contacts.id',
    name: 'contacts.name',
    ownerId: 'contacts.ownerId',
  },
  conversions: { id: 'conversions.id' },
  leads: {
    contactId: 'leads.contactId',
    deletedAt: 'leads.deletedAt',
    id: 'leads.id',
    ownerId: 'leads.ownerId',
  },
  pipelines: { id: 'pipelines.id', isDefault: 'pipelines.isDefault' },
  pipelineStages: { pipelineId: 'pipelineStages.pipelineId', position: 'pipelineStages.position' },
  stageTransitions: { id: 'stageTransitions.id' },
}))

vi.mock('@phynd/config/features', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}))

// Mock OpenAI so the constructor does not throw on missing API key.
// The service's draftResponse() catches errors gracefully, so even when
// the mock doesn't perfectly replicate the OpenAI client shape, the
// integration test still validates the full pipeline flow.
const openaiConstructorSpy = vi.fn()
vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: vi.fn() } }
    constructor(opts?: Record<string, unknown>) {
      openaiConstructorSpy(opts)
    }
  }
  return { default: MockOpenAI }
})
// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import {
  type BotCampaignPayload,
  RedditBotService,
  mapDomainToMateria,
} from '../campaigns/reddit-bot'

// ---------------------------------------------------------------------------
// mapDomainToMateria — pure function, no mocks needed
// ---------------------------------------------------------------------------
describe('mapDomainToMateria', () => {
  it('maps "labor" to "laboral"', () => {
    expect(mapDomainToMateria('labor')).toBe('laboral')
  })

  it('maps "laboral" passthrough', () => {
    expect(mapDomainToMateria('laboral')).toBe('laboral')
  })

  it('maps "employment" to "laboral"', () => {
    expect(mapDomainToMateria('employment')).toBe('laboral')
  })

  it('maps "tax" to "administrativa"', () => {
    expect(mapDomainToMateria('tax')).toBe('administrativa')
  })

  it('maps "fiscal" to "administrativa"', () => {
    expect(mapDomainToMateria('fiscal')).toBe('administrativa')
  })

  it('maps "administrative" to "administrativa"', () => {
    expect(mapDomainToMateria('administrative')).toBe('administrativa')
  })

  it('maps "criminal" to "penal"', () => {
    expect(mapDomainToMateria('criminal')).toBe('penal')
  })

  it('maps "penal" passthrough', () => {
    expect(mapDomainToMateria('penal')).toBe('penal')
  })

  it('maps "civil" passthrough', () => {
    expect(mapDomainToMateria('civil')).toBe('civil')
  })

  it('maps "family" to "civil"', () => {
    expect(mapDomainToMateria('family')).toBe('civil')
  })

  it('maps "familiar" to "civil"', () => {
    expect(mapDomainToMateria('familiar')).toBe('civil')
  })

  it('maps "commercial" to "civil"', () => {
    expect(mapDomainToMateria('commercial')).toBe('civil')
  })

  it('maps "mercantil" to "civil"', () => {
    expect(mapDomainToMateria('mercantil')).toBe('civil')
  })

  it('maps "constitutional" to "constitucional"', () => {
    expect(mapDomainToMateria('constitutional')).toBe('constitucional')
  })

  it('maps "amparo" to "constitucional"', () => {
    expect(mapDomainToMateria('amparo')).toBe('constitucional')
  })

  it('defaults unknown domains to "civil"', () => {
    expect(mapDomainToMateria('unknown-domain')).toBe('civil')
    expect(mapDomainToMateria('')).toBe('civil')
    expect(mapDomainToMateria('gibberish')).toBe('civil')
  })

  it('normalises case and whitespace', () => {
    expect(mapDomainToMateria('LABOR')).toBe('laboral')
    expect(mapDomainToMateria('  Tax  ')).toBe('administrativa')
    expect(mapDomainToMateria('Criminal')).toBe('penal')
    expect(mapDomainToMateria('CONSTITUTIONAL')).toBe('constitucional')
  })
})

// ---------------------------------------------------------------------------
// queryTezcaArticles — semantic-first with keyword fallback
// ---------------------------------------------------------------------------
describe('RedditBotService.queryTezcaArticles (via processWebhook)', () => {
  let service: RedditBotService

  beforeEach(() => {
    vi.stubEnv('TEZCA_API_URL', 'http://tezca-test:8000')
    vi.stubEnv('INTERNAL_TEZCA_KEY', 'test-key')
    const ctx = createTestContext()
    service = new RedditBotService(ctx)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('uses semantic search results when semantic endpoint returns 200 with hits', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    // queryTezcaArticles: semantic endpoint returns results
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ law_title: 'LFT', number: '48', text: 'Indemnizacion constitucional...' }],
      }),
    } as Response)

    // queryTezcaJudicial: standard judicial search
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response)

    // Access private method via bracket notation
    const articlesResult = await (
      service as unknown as { queryTezcaArticles: (q: string) => Promise<string> }
    ).queryTezcaArticles('despido injustificado')

    expect(articlesResult).toContain('LFT')
    expect(articlesResult).toContain('48')
    // Should have only made ONE fetch call (semantic succeeded, no fallback needed)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/search/semantic/'),
      expect.any(Object),
    )
  })

  it('falls back to keyword search when semantic endpoint returns non-ok', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    // queryTezcaArticles: semantic endpoint returns 404
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response)

    // queryTezcaArticles: keyword endpoint returns results
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ law_title: 'CPEUM', number: '123', text: 'Toda persona tiene derecho...' }],
      }),
    } as Response)

    const articlesResult = await (
      service as unknown as { queryTezcaArticles: (q: string) => Promise<string> }
    ).queryTezcaArticles('derechos laborales')

    expect(articlesResult).toContain('CPEUM')
    expect(articlesResult).toContain('123')
    // Should have made TWO fetch calls (semantic failed, keyword succeeded)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/api/v1/search/semantic/'),
      expect.any(Object),
    )
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/v1/search/articles/'),
      expect.any(Object),
    )
  })

  it('falls back to keyword search when semantic returns empty results', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    // queryTezcaArticles: semantic endpoint returns 200 but empty results
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response)

    // queryTezcaArticles: keyword endpoint returns results
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ law_title: 'LFT', number: '50', text: 'Las indemnizaciones...' }],
      }),
    } as Response)

    const articlesResult = await (
      service as unknown as { queryTezcaArticles: (q: string) => Promise<string> }
    ).queryTezcaArticles('indemnizacion')

    expect(articlesResult).toContain('LFT')
    expect(articlesResult).toContain('50')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('returns fallback message when both endpoints fail', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    // queryTezcaArticles: semantic endpoint throws
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    // queryTezcaArticles: keyword endpoint also throws
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const articlesResult = await (
      service as unknown as { queryTezcaArticles: (q: string) => Promise<string> }
    ).queryTezcaArticles('query')

    expect(articlesResult).toBe('No specific articles found. Consult general framework.')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('returns fallback message when both endpoints return non-ok', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    // queryTezcaArticles: semantic returns 500
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 } as Response)
    // queryTezcaArticles: keyword returns 503
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 503 } as Response)

    const articlesResult = await (
      service as unknown as { queryTezcaArticles: (q: string) => Promise<string> }
    ).queryTezcaArticles('query')

    expect(articlesResult).toBe('No specific articles found. Consult general framework.')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// queryTezcaJudicial — HTTP fetch mock
// ---------------------------------------------------------------------------
describe('RedditBotService.queryTezcaJudicial', () => {
  let service: RedditBotService

  beforeEach(() => {
    vi.stubEnv('TEZCA_API_URL', 'http://tezca-test:8000')
    vi.stubEnv('INTERNAL_TEZCA_KEY', 'test-key')
    const ctx = createTestContext()
    service = new RedditBotService(ctx)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('returns formatted judicial hits on success', async () => {
    const mockResponse = {
      results: [
        {
          registro: 'REG-001',
          rubro: 'Despido injustificado',
          text: 'El trabajador tiene derecho...',
        },
        { registro: 'REG-002', rubro: 'Indemnizacion laboral', text: 'Corresponde al patron...' },
      ],
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    const result = await service.queryTezcaJudicial('despido injustificado', 'laboral')

    expect(result).toContain('Registro: REG-001')
    expect(result).toContain('Rubro: Despido injustificado')
    expect(result).toContain('Registro: REG-002')
  })

  it('passes query and materia as URL params', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response)

    await service.queryTezcaJudicial('test query', 'penal')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('q=test+query'),
      expect.any(Object),
    )
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('materia=penal'),
      expect.any(Object),
    )
  })

  it('returns fallback when no results found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response)

    const result = await service.queryTezcaJudicial('obscure query', 'civil')
    expect(result).toBe('No judicial precedent found for this materia.')
  })

  it('returns fallback on non-ok HTTP response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response)

    const result = await service.queryTezcaJudicial('query', 'laboral')
    expect(result).toBe('Judicial precedent unavailable.')
  })

  it('returns fallback on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const result = await service.queryTezcaJudicial('query', 'civil')
    expect(result).toBe('Judicial oracle offline.')
  })

  it('limits results to top 2 hits', async () => {
    const mockResponse = {
      results: [
        { registro: 'R1', rubro: 'One', text: 'First' },
        { registro: 'R2', rubro: 'Two', text: 'Second' },
        { registro: 'R3', rubro: 'Three', text: 'Third' },
      ],
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    const result = await service.queryTezcaJudicial('multi result', 'civil')
    expect(result).toContain('R1')
    expect(result).toContain('R2')
    expect(result).not.toContain('R3')
  })

  it('handles missing optional fields in results', async () => {
    const mockResponse = {
      results: [{ text: 'Some text without registro or rubro' }],
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    const result = await service.queryTezcaJudicial('query', 'laboral')
    expect(result).toContain('Registro: N/A')
    expect(result).toContain('Rubro: Sin rubro')
  })

  it('truncates long text at 400 characters', async () => {
    const longText = 'A'.repeat(600)
    const mockResponse = {
      results: [{ registro: 'R1', rubro: 'Test', text: longText }],
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    const result = await service.queryTezcaJudicial('query', 'civil')
    const extracto = result.split('Extracto: ')[1]
    expect(extracto).toHaveLength(400)
  })

  it('uses configured TEZCA_API_URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response)

    await service.queryTezcaJudicial('query', 'civil')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('http://tezca-test:8000/api/v1/judicial/search/'),
      expect.any(Object),
    )
  })
})

// ---------------------------------------------------------------------------
// Full processWebhook integration
// ---------------------------------------------------------------------------
describe('RedditBotService.processWebhook', () => {
  let service: RedditBotService
  let mockDb: MockDatabase

  const payload: BotCampaignPayload = {
    campaign_type: 'legal_outreach',
    bot_identity: 'MadfamBot',
    outreach_target: {
      url: 'https://www.reddit.com/r/DerechoMexicano/comments/abc123/my_post/',
      author: 'testuser',
      original_post_content: 'Me despidieron injustamente de mi trabajo...',
    },
    legal_context: {
      distress_sentiment: 'high',
      core_legal_problem: 'despido injustificado',
      domain: 'labor',
    },
    orchestration: {
      instruction: 'Respond with empathy and cite applicable articles.',
    },
  }

  beforeEach(() => {
    vi.stubEnv('TEZCA_API_URL', 'http://tezca-test:8000')
    vi.stubEnv('INTERNAL_TEZCA_KEY', 'test-key')
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new RedditBotService(ctx)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('orchestrates full pipeline: Tezca queries + contact upsert + lead + campaign', async () => {
    // Mock Tezca articles fetch (semantic succeeds on first try)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ law_title: 'LFT', number: '48', text: 'Indemnizacion...' }],
        }),
      } as Response)
      // queryTezcaJudicial
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ registro: 'REG-001', rubro: 'Despido', text: 'Jurisprudencia...' }],
        }),
      } as Response)

    const contact = makeContact({ id: 'contact-new', name: 'u/testuser' })
    const lead = makeLead({ id: 'lead-new', contactId: 'contact-new' })
    const pipeline = makePipeline({ id: 'pipeline-001', isDefault: true })
    const stage = makePipelineStage({ id: 'stage-001', pipelineId: 'pipeline-001' })
    const campaign = makeCampaign({ id: 'campaign-new' })

    let callCount = 0
    mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
      callCount++
      const results: Record<number, unknown> = {
        1: [], // getByName -> not found
        2: [contact], // insert contact
        3: [pipeline], // getDefault pipeline
        4: [stage], // getStages
        5: [lead], // insert lead (inside transaction)
        6: [{ id: 'conv-001' }], // conversion insert
        7: [campaign], // insert campaign
      }
      return Promise.resolve(results[callCount] ?? []).then(resolve)
    })

    const result = await service.processWebhook(payload)

    expect(result.status).toBe('success')
    expect(result.draft_stage_id).toBe('campaign-new')
    expect(result.contactId).toBe('contact-new')
    // Verify Tezca was called twice (articles semantic + judicial)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('makes 3 fetch calls when semantic falls back to keyword', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy
      // queryTezcaArticles: semantic endpoint fails
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      // queryTezcaArticles: keyword endpoint succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ law_title: 'LFT', number: '48', text: 'Indemnizacion...' }],
        }),
      } as Response)
      // queryTezcaJudicial
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      } as Response)

    const contact = makeContact({ id: 'contact-new', name: 'u/testuser' })
    const lead = makeLead({ id: 'lead-new', contactId: 'contact-new' })
    const pipeline = makePipeline({ id: 'pipeline-001', isDefault: true })
    const stage = makePipelineStage({ id: 'stage-001', pipelineId: 'pipeline-001' })
    const campaign = makeCampaign({ id: 'campaign-new' })

    let callCount = 0
    mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
      callCount++
      const results: Record<number, unknown> = {
        1: [], // getByName -> not found
        2: [contact], // insert contact
        3: [pipeline], // getDefault pipeline
        4: [stage], // getStages
        5: [lead], // insert lead
        6: [{ id: 'conv-001' }],
        7: [campaign],
      }
      return Promise.resolve(results[callCount] ?? []).then(resolve)
    })

    const result = await service.processWebhook(payload)

    expect(result.status).toBe('success')
    // Verify 3 fetch calls: semantic (fail) + keyword (success) + judicial
    expect(fetchSpy).toHaveBeenCalledTimes(3)
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/api/v1/search/semantic/'),
      expect.any(Object),
    )
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/v1/search/articles/'),
      expect.any(Object),
    )
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('/api/v1/judicial/search/'),
      expect.any(Object),
    )
  })

  it('reuses existing contact when found by name', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      } as Response)

    const existingContact = makeContact({ id: 'contact-existing', name: 'u/testuser' })
    const lead = makeLead({ id: 'lead-new', contactId: 'contact-existing' })
    const pipeline = makePipeline({ id: 'pipeline-001', isDefault: true })
    const stage = makePipelineStage({ id: 'stage-001', pipelineId: 'pipeline-001' })
    const campaign = makeCampaign({ id: 'campaign-new' })

    let callCount = 0
    mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
      callCount++
      const results: Record<number, unknown> = {
        1: [existingContact], // getByName -> found!
        2: [pipeline], // getDefault pipeline
        3: [stage], // getStages
        4: [lead], // insert lead (inside transaction)
        5: [{ id: 'conv-001' }], // conversion insert
        6: [campaign], // insert campaign
      }
      return Promise.resolve(results[callCount] ?? []).then(resolve)
    })

    const result = await service.processWebhook(payload)

    expect(result.status).toBe('success')
    expect(result.contactId).toBe('contact-existing')
  })

  it('throws when no default pipeline is configured', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      } as Response)

    let callCount = 0
    mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
      callCount++
      const results: Record<number, unknown> = {
        1: [], // getByName -> not found
        2: [makeContact({ id: 'c1' })], // insert contact
        3: [], // getDefault -> null (no default pipeline!)
      }
      return Promise.resolve(results[callCount] ?? []).then(resolve)
    })

    await expect(service.processWebhook(payload)).rejects.toThrow('No default pipeline configured')
  })
})

// ---------------------------------------------------------------------------
// OpenAI baseURL routing — AutoSwarm integration
// ---------------------------------------------------------------------------
describe('RedditBotService OpenAI baseURL routing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    openaiConstructorSpy.mockClear()
  })

  it('passes OPENAI_BASE_URL to OpenAI client when set', () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_BASE_URL', 'http://nexus-api.autoswarm.svc.cluster.local/v1')
    vi.stubEnv('TEZCA_API_URL', 'http://tezca-test:8000')
    vi.stubEnv('INTERNAL_TEZCA_KEY', 'test-key')
    const ctx = createTestContext()
    new RedditBotService(ctx)
    expect(openaiConstructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-key',
        baseURL: 'http://nexus-api.autoswarm.svc.cluster.local/v1',
      }),
    )
  })

  it('omits baseURL when OPENAI_BASE_URL is not set', () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    delete process.env.OPENAI_BASE_URL
    vi.stubEnv('TEZCA_API_URL', 'http://tezca-test:8000')
    vi.stubEnv('INTERNAL_TEZCA_KEY', 'test-key')
    const ctx = createTestContext()
    new RedditBotService(ctx)
    expect(openaiConstructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'test-key' }),
    )
    const opts = openaiConstructorSpy.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(opts?.baseURL).toBeUndefined()
  })
})

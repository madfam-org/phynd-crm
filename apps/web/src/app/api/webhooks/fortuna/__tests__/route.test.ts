import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock modules — top-level mock state must be wrapped in vi.hoisted() because
// vi.mock() factories are hoisted above all const declarations. Without
// hoisted(), the factory runs before the const initializer, so referencing
// mockDb / mockQb / etc. inside the factory throws ReferenceError.
// ---------------------------------------------------------------------------

type MockQueryBuilder = {
  _result: unknown[]
  from: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  orderBy: ReturnType<typeof vi.fn>
  returning: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  then: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  values: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
}

const {
  mockCheckRateLimit,
  mockValidateWebhookSignature,
  mockQb,
  mockDb,
  mockGetDefaultPipeline,
  mockGetStages,
} = vi.hoisted(() => {
  const mockGetDefaultPipeline = vi.fn()
  const mockGetStages = vi.fn()
  const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 99 })
  const mockValidateWebhookSignature = vi.fn().mockReturnValue(true)

  const mockQb = {
    _result: [] as unknown[],
    from: vi.fn(),
    insert: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
    returning: vi.fn(),
    select: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
    values: vi.fn(),
    where: vi.fn(),
  } as MockQueryBuilder

  for (const method of Object.keys(mockQb).filter((k) => k !== '_result')) {
    ;(mockQb as unknown as Record<string, ReturnType<typeof vi.fn>>)[method]?.mockReturnValue(
      mockQb,
    )
  }

  Object.defineProperty(mockQb, 'then', {
    value: vi.fn((resolve: (v: unknown) => void) => Promise.resolve(mockQb._result).then(resolve)),
    configurable: true,
    enumerable: false,
  })

  const mockDb = {
    delete: vi.fn().mockReturnValue(mockQb),
    insert: vi.fn().mockReturnValue(mockQb),
    select: vi.fn().mockReturnValue(mockQb),
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(mockDb)),
    update: vi.fn().mockReturnValue(mockQb),
  }

  return {
    mockCheckRateLimit,
    mockValidateWebhookSignature,
    mockQb,
    mockDb,
    mockGetDefaultPipeline,
    mockGetStages,
  }
})

vi.mock('@/lib/webhooks/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

vi.mock('@phynd/federation/webhooks', () => ({
  validateWebhookSignature: (...args: unknown[]) => mockValidateWebhookSignature(...args),
}))

vi.mock('@phynd/db', () => ({
  getDb: vi.fn(() => mockDb),
}))

vi.mock('@/lib/federation/clients', () => ({
  getCacheManager: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('@phynd/db/schema', () => ({
  contacts: {
    company: 'contacts.company',
    deletedAt: 'contacts.deletedAt',
    email: 'contacts.email',
    id: 'contacts.id',
  },
  leads: { id: 'leads.id' },
  notes: { id: 'notes.id' },
  webhookEvents: {
    id: 'webhookEvents.id',
    payload: 'webhookEvents.payload',
    provider: 'webhookEvents.provider',
  },
  grantApplications: {
    complianceChecks: 'grantApplications.complianceChecks',
    deletedAt: 'grantApplications.deletedAt',
    grantOpportunityId: 'grantApplications.grantOpportunityId',
    id: 'grantApplications.id',
    ownerId: 'grantApplications.ownerId',
    status: 'grantApplications.status',
    stageId: 'grantApplications.stageId',
  },
  grantOpportunities: {
    closesAt: 'grantOpportunities.closesAt',
    fortunaGrantId: 'grantOpportunities.fortunaGrantId',
    id: 'grantOpportunities.id',
  },
  grantSignalAudit: {
    createdAt: 'grantSignalAudit.createdAt',
    grantApplicationId: 'grantSignalAudit.grantApplicationId',
    grantOpportunityId: 'grantSignalAudit.grantOpportunityId',
    id: 'grantSignalAudit.id',
  },
  pipelineStages: {
    id: 'pipelineStages.id',
    pipelineId: 'pipelineStages.pipelineId',
  },
  pipelines: {
    id: 'pipelines.id',
    name: 'pipelines.name',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    _tag: 'sql',
    text: strings.join('?'),
    values,
  })),
}))

vi.mock('@phynd/logging', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@phynd/services', () => ({
  GrantsService: vi.fn().mockImplementation(() => ({
    upsertOpportunity: vi.fn().mockResolvedValue({ id: 'grant-opp-001', fortunaGrantId: 'f-123' }),
    createApplication: vi.fn().mockResolvedValue({ id: 'grant-app-001' }),
  })),
  PipelinesService: vi.fn().mockImplementation(() => ({
    getDefault: mockGetDefaultPipeline,
    getStages: mockGetStages,
  })),
  createServiceContext: vi.fn().mockReturnValue({
    db: mockDb,
    cache: {},
    auth: {
      userId: 'system:fortuna-webhook',
      tenantId: 'madfam',
      roles: ['admin'],
      scopes: ['*'],
      accessToken: '',
    },
    tenantId: 'madfam',
  }),
}))

// Mock BullMQ Queue
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

import * as schema from '@phynd/db/schema'
import { Queue } from 'bullmq'
import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSignedRequest(
  body: object,
  options: { secret?: string; customHeaders?: Record<string, string> } = {},
) {
  const secret = options.secret ?? 'test-secret'
  const bodyStr = JSON.stringify(body)
  const signature = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex')

  return new Request('http://localhost/api/webhooks/fortuna', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Fortuna-Signature': signature,
      'X-Webhook-Timestamp': new Date().toISOString(),
      ...(options.customHeaders ?? {}),
    },
    body: bodyStr,
  })
}

const validPayload = {
  type: 'grant.discovered',
  data: {
    fortuna_grant_id: 'fortuna-123',
    title: 'Innovation Grant 2025',
    granting_body: 'CONACYT',
    category: 'technology',
    max_amount: '500000.00',
    currency: 'MXN',
  },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Fortuna webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FORTUNA_WEBHOOK_SECRET = 'test-secret'
    process.env.REDIS_URL = 'redis://localhost:6379'
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 99 })
    mockValidateWebhookSignature.mockReturnValue(true)

    // Setup DB mock chain for pipeline/stage lookup
    let selectCallCount = 0
    mockQb.then.mockImplementation((resolve: (v: unknown) => void) => {
      selectCallCount++
      // 1st select: pipeline lookup, 2nd: stages lookup, 3rd: existing apps, rest: service calls
      if (selectCallCount === 1) {
        return Promise.resolve([{ id: 'pipeline-treasury', name: 'Treasury Hunter' }]).then(resolve)
      }
      if (selectCallCount === 2) {
        return Promise.resolve([
          {
            id: 'stage-discovered',
            name: 'Discovered',
            pipelineId: 'pipeline-treasury',
            position: 0,
          },
        ]).then(resolve)
      }
      return Promise.resolve([{ id: 'grant-opp-001' }]).then(resolve)
    })
  })

  afterEach(() => {
    delete process.env.FORTUNA_WEBHOOK_SECRET
    delete process.env.REDIS_URL
  })

  function requireResponse(res: Awaited<ReturnType<typeof POST>>): Response {
    if (!res) {
      throw new Error('Expected Fortuna webhook response')
    }
    return res
  }

  it('returns 503 when webhook secret is not configured', async () => {
    delete process.env.FORTUNA_WEBHOOK_SECRET
    const req = createSignedRequest(validPayload)
    const res = requireResponse(await POST(req))
    expect(res.status).toBe(503)
  })

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 })
    const req = createSignedRequest(validPayload)
    const res = requireResponse(await POST(req))
    expect(res.status).toBe(429)
  })

  it('returns 401 when signature is invalid', async () => {
    mockValidateWebhookSignature.mockReturnValue(false)
    const req = createSignedRequest(validPayload)
    const res = requireResponse(await POST(req))
    expect(res.status).toBe(401)
  })

  it('returns 401 when timestamp is expired', async () => {
    const bodyStr = JSON.stringify(validPayload)
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10 min ago

    const req = new Request('http://localhost/api/webhooks/fortuna', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Fortuna-Signature': 'any',
        'X-Webhook-Timestamp': oldTimestamp,
      },
      body: bodyStr,
    })

    const res = requireResponse(await POST(req))
    expect(res.status).toBe(401)
  })

  it('processes grant.discovered event successfully', async () => {
    const req = createSignedRequest(validPayload)
    const res = requireResponse(await POST(req))
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.received).toBe(true)
  })

  it('ignores non-grant.discovered events', async () => {
    const payload = { type: 'grant.updated', data: {} }
    const req = createSignedRequest(payload)
    const res = requireResponse(await POST(req))
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.received).toBe(true)
  })

  it('returns 400 for malformed payload', async () => {
    const payload = { type: 'grant.discovered', data: {} }
    const req = createSignedRequest(payload)
    const res = requireResponse(await POST(req))
    expect(res.status).toBe(400)
  })

  it('uses X-Fortuna-Signature header (not X-Webhook-Signature)', async () => {
    const req = createSignedRequest(validPayload)
    await POST(req)

    // The validate call should have received the signature from X-Fortuna-Signature
    expect(mockValidateWebhookSignature).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// prospect.qualified — envelope as built by Fortuna's prospect dispatcher
// ---------------------------------------------------------------------------

function prospectEnvelope(overrides: { data?: Record<string, unknown>; [key: string]: unknown } = {}) {
  const { data, ...rest } = overrides
  return {
    event: 'prospect.qualified',
    idempotency_key: 'prospect-001',
    timestamp: new Date().toISOString(),
    data: {
      prospect_id: 'prospect-001',
      tenant_id: 'tenant-a',
      domain: 'example-shop.mx',
      business_name: 'Example Shop',
      tmm_score: 0.82,
      confidence: 0.7,
      decision_makers: [
        {
          name: 'Ana Pérez',
          role: 'Directora',
          source_url: 'https://example-shop.mx/',
          profile_urls: ['https://social.example/ana-perez'],
        },
      ],
      evidence: {
        contact_emails: {
          value: ['Hola@Example-Shop.mx'],
          source_url: 'https://example-shop.mx/',
          collected_at: '2026-11-10T00:00:00+00:00',
        },
        has_spf: { value: false, source_url: 'dns:example-shop.mx' },
      },
      ...data,
    },
    ...rest,
  }
}

async function postProspect(req: Request): Promise<Response> {
  const res = await POST(req)
  if (!res) throw new Error('Expected Fortuna webhook response')
  return res
}

/** Results for each awaited query, in the order the handler awaits them. */
function queueQueryResults(...results: unknown[][]) {
  const queue = [...results]
  mockQb.then.mockImplementation((resolve: (v: unknown) => void) =>
    Promise.resolve(queue.shift() ?? []).then(resolve),
  )
}

function insertedValues(table: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  mockDb.insert.mock.calls.forEach((call, index) => {
    if (call[0] === table) {
      const valuesCall = mockQb.values.mock.calls[index]
      if (valuesCall) out.push(valuesCall[0] as Record<string, unknown>)
    }
  })
  return out
}

describe('Fortuna webhook route — prospect.qualified', () => {
  const fetchSpy = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FORTUNA_WEBHOOK_SECRET = 'test-secret'
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 99 })
    mockValidateWebhookSignature.mockReturnValue(true)
    mockGetDefaultPipeline.mockResolvedValue({ id: 'pipeline-default', isDefault: true })
    mockGetStages.mockResolvedValue([
      { id: 'stage-first', position: 0 },
      { id: 'stage-second', position: 1 },
    ])
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.FORTUNA_WEBHOOK_SECRET
  })

  it('creates a contact, a lead in the default pipeline first stage and a review note', async () => {
    // dedup lookup, contact-by-email lookup, contact insert, lead insert, note, event
    queueQueryResults([], [], [{ id: 'contact-new' }], [{ id: 'lead-new' }], [], [])

    const res = await postProspect(createSignedRequest(prospectEnvelope()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      received: true,
      contactId: 'contact-new',
      leadId: 'lead-new',
      contactReused: false,
    })

    const [contact] = insertedValues(schema.contacts)
    expect(contact).toMatchObject({
      name: 'Ana Pérez',
      email: 'hola@example-shop.mx',
      company: 'Example Shop',
      marketingConsent: false,
      consentedAt: null,
    })

    const [lead] = insertedValues(schema.leads)
    expect(lead).toEqual({
      contactId: 'contact-new',
      source: 'fortuna',
      pipelineId: 'pipeline-default',
      stageId: 'stage-first',
      unsubscribed: true,
    })

    const [note] = insertedValues(schema.notes)
    expect(note).toMatchObject({ entityType: 'lead', entityId: 'lead-new' })
    expect(note?.content).toContain('Puntaje TMM: 0.82')
    expect(note?.content).toContain('Ana Pérez (Directora)')
    expect(note?.content).toContain('has_spf: false (dns:example-shop.mx)')

    const [event] = insertedValues(schema.webhookEvents)
    expect(event).toMatchObject({
      provider: 'fortuna',
      eventType: 'prospect.qualified',
      payload: expect.objectContaining({ idempotency_key: 'prospect-001' }),
    })
  })

  it('returns deduplicated on replay of the same idempotency key without writing', async () => {
    queueQueryResults([{ id: 'webhook-event-1' }])

    const res = await postProspect(createSignedRequest(prospectEnvelope()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, deduplicated: true })
    expect(mockDb.insert).not.toHaveBeenCalled()
    expect(mockDb.transaction).not.toHaveBeenCalled()

    const sqlMock = vi.mocked((await import('drizzle-orm')).sql)
    expect(sqlMock.mock.calls.at(-1)?.slice(1)).toContain('prospect-001')
  })

  it('reuses an existing contact with the same email and never overwrites its data', async () => {
    const existing = {
      id: 'contact-existing',
      name: 'Nombre ya capturado',
      email: 'hola@example-shop.mx',
      company: 'Razón social capturada',
      marketingConsent: false,
    }
    queueQueryResults([], [existing], [{ id: 'lead-new' }], [], [])

    const res = await postProspect(createSignedRequest(prospectEnvelope()))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ contactId: 'contact-existing', contactReused: true })

    expect(insertedValues(schema.contacts)).toHaveLength(0)
    expect(mockDb.update).not.toHaveBeenCalled()
    expect(insertedValues(schema.leads)[0]).toMatchObject({ contactId: 'contact-existing' })
  })

  it('fills only a blank company on an existing contact', async () => {
    const existing = { id: 'contact-existing', name: 'X', email: 'hola@example-shop.mx', company: null }
    queueQueryResults([], [existing], [], [{ id: 'lead-new' }], [], [])

    const res = await postProspect(createSignedRequest(prospectEnvelope()))
    expect(res.status).toBe(200)
    expect(mockDb.update).toHaveBeenCalledWith(schema.contacts)
    expect(mockQb.set).toHaveBeenCalledWith({ company: 'Example Shop' })
  })

  it('creates a new contact without email lookup when no address was collected', async () => {
    queueQueryResults([], [{ id: 'contact-new' }], [{ id: 'lead-new' }], [], [])

    const res = await postProspect(
      createSignedRequest(
        prospectEnvelope({ data: { decision_makers: [], evidence: {}, business_name: undefined } }),
      ),
    )
    expect(res.status).toBe(200)
    expect(insertedValues(schema.contacts)[0]).toMatchObject({
      name: 'example-shop.mx',
      email: undefined,
      company: 'example-shop.mx',
      marketingConsent: false,
    })
  })

  it.each([
    ['prospect_id', { prospect_id: undefined }, { idempotency_key: undefined }],
    ['domain and business_name', { domain: '', business_name: null }, {}],
  ])('returns 400 when %s is missing', async (_label, data, envelope) => {
    const res = await postProspect(createSignedRequest(prospectEnvelope({ data, ...envelope })))
    expect(res.status).toBe(400)
    expect(mockDb.insert).not.toHaveBeenCalled()
  })

  it('returns 500 and writes nothing when no default pipeline exists', async () => {
    queueQueryResults([])
    mockGetDefaultPipeline.mockResolvedValue(null)

    const res = await postProspect(createSignedRequest(prospectEnvelope()))
    expect(res.status).toBe(500)
    expect(mockDb.insert).not.toHaveBeenCalled()
  })

  it('also accepts the event name in `type`', async () => {
    queueQueryResults([], [], [{ id: 'contact-new' }], [{ id: 'lead-new' }], [], [])
    const { event: _event, ...rest } = prospectEnvelope()
    const res = await postProspect(createSignedRequest({ ...rest, type: 'prospect.qualified' }))
    expect(res.status).toBe(200)
    expect(insertedValues(schema.leads)).toHaveLength(1)
  })

  it('triggers nothing outbound and records no consent', async () => {
    queueQueryResults([], [], [{ id: 'contact-new' }], [{ id: 'lead-new' }], [], [])

    const res = await postProspect(createSignedRequest(prospectEnvelope()))
    expect(res.status).toBe(200)

    // No job queue (drips, campaigns, compliance), no HTTP call of any kind.
    expect(Queue).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()

    // Only the four review records are written: no consent or campaign rows.
    const writtenTables = mockDb.insert.mock.calls.map((call) => call[0])
    expect(writtenTables).toEqual([
      schema.contacts,
      schema.leads,
      schema.notes,
      schema.webhookEvents,
    ])
    expect(insertedValues(schema.contacts)[0]?.marketingConsent).toBe(false)
    expect(insertedValues(schema.leads)[0]?.unsubscribed).toBe(true)
  })
})

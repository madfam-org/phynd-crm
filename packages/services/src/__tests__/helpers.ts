import type { AuthContext } from '@phyne/types/auth'
import { vi } from 'vitest'
import type { ServiceContext } from '../context'

// ---------------------------------------------------------------------------
// Chainable query builder mock
// ---------------------------------------------------------------------------
// Drizzle ORM uses a chained API:  db.select().from(t).where(c).orderBy(f).limit(n)
// We need every method to return `this` so chains work, and the terminal
// awaitable resolves to whatever `_result` is set to on the builder.
// ---------------------------------------------------------------------------

export interface MockQueryBuilder {
  _result: unknown
  delete: ReturnType<typeof vi.fn>
  from: ReturnType<typeof vi.fn>
  groupBy: ReturnType<typeof vi.fn>
  innerJoin: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  leftJoin: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  onConflictDoNothing: ReturnType<typeof vi.fn>
  orderBy: ReturnType<typeof vi.fn>
  returning: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  then: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  values: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
}

export function createMockQueryBuilder(result: unknown = []): MockQueryBuilder {
  const builder: MockQueryBuilder = {
    _result: result,
    delete: vi.fn(),
    from: vi.fn(),
    groupBy: vi.fn(),
    innerJoin: vi.fn(),
    insert: vi.fn(),
    leftJoin: vi.fn(),
    limit: vi.fn(),
    onConflictDoNothing: vi.fn(),
    orderBy: vi.fn(),
    returning: vi.fn(),
    select: vi.fn(),
    set: vi.fn(),
    // biome-ignore lint/suspicious/noThenProperty: mock needs `then` to be awaitable
    then: vi.fn(),
    update: vi.fn(),
    values: vi.fn(),
    where: vi.fn(),
  }

  // Every chainable method returns the builder itself
  for (const method of [
    'delete',
    'from',
    'groupBy',
    'innerJoin',
    'insert',
    'leftJoin',
    'limit',
    'onConflictDoNothing',
    'orderBy',
    'returning',
    'select',
    'set',
    'update',
    'values',
    'where',
  ]) {
    ;(builder as unknown as Record<string, ReturnType<typeof vi.fn>>)[method]?.mockReturnValue(
      builder,
    )
  }

  // `.then` makes the builder awaitable and resolves to `_result`
  builder.then.mockImplementation((resolve: (v: unknown) => void) => {
    return Promise.resolve(builder._result).then(resolve)
  })

  return builder
}

// ---------------------------------------------------------------------------
// Mock database
// ---------------------------------------------------------------------------

export interface MockDatabase {
  _qb: MockQueryBuilder
  delete: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
  transaction: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

export function createMockDb(defaultResult: unknown = []): MockDatabase {
  const qb = createMockQueryBuilder(defaultResult)

  const db: MockDatabase = {
    _qb: qb,
    delete: vi.fn().mockReturnValue(qb),
    insert: vi.fn().mockReturnValue(qb),
    select: vi.fn().mockReturnValue(qb),
    transaction: vi.fn(),
    update: vi.fn().mockReturnValue(qb),
  }

  // transaction mock: executes the callback with the db itself acting as `tx`
  db.transaction.mockImplementation(async (cb: (tx: MockDatabase) => Promise<unknown>) => {
    return cb(db)
  })

  return db
}

// ---------------------------------------------------------------------------
// Mock cache
// ---------------------------------------------------------------------------

export interface MockCache {
  delete: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  invalidate: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
}

export function createMockCache(): MockCache {
  return {
    delete: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    invalidate: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
  }
}

// ---------------------------------------------------------------------------
// Mock auth context
// ---------------------------------------------------------------------------

export function createMockAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    accessToken: 'test-token-abc123',
    roles: ['admin'],
    scopes: ['*'],
    tenantId: 'madfam',
    userId: 'test-user',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Full test context
// ---------------------------------------------------------------------------

export function createTestContext(
  dbResult: unknown = [],
  overrides: {
    auth?: Partial<AuthContext>
  } = {},
): ServiceContext & { mockDb: MockDatabase; mockCache: MockCache } {
  const mockDb = createMockDb(dbResult)
  const mockCache = createMockCache()
  const auth = createMockAuth(overrides.auth)

  const ctx: ServiceContext = {
    auth,
    cache: mockCache as unknown as ServiceContext['cache'],
    db: mockDb as unknown as ServiceContext['db'],
    tenantId: 'madfam',
  }

  return { ...ctx, mockCache, mockDb }
}

// ---------------------------------------------------------------------------
// Factory helpers for test data
// ---------------------------------------------------------------------------

export function makeContact(overrides: Record<string, unknown> = {}) {
  return {
    company: 'Acme Corp',
    createdAt: new Date('2025-01-15T10:00:00Z'),
    deletedAt: null,
    email: 'john@acme.com',
    externalJanuaId: null,
    id: 'contact-001',
    name: 'John Doe',
    ownerId: null,
    phone: null,
    status: 'active',
    updatedAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  }
}

export function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    contactId: null,
    createdAt: new Date('2025-01-15T10:00:00Z'),
    deletedAt: null,
    externalJanuaId: null,
    id: 'lead-001',
    ownerId: null,
    pipelineId: 'pipeline-001',
    score: null,
    source: 'web',
    stageId: 'stage-001',
    status: 'new',
    updatedAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  }
}

export function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    authorId: 'test-user',
    content: 'Test note content',
    createdAt: new Date('2025-01-15T10:00:00Z'),
    entityId: 'entity-001',
    entityType: 'contact',
    id: 'note-001',
    isPinned: false,
    updatedAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  }
}

export function makeOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    contactId: null,
    createdAt: new Date('2025-01-15T10:00:00Z'),
    deletedAt: null,
    expectedCloseDate: null,
    id: 'opp-001',
    name: 'Test Opportunity',
    ownerId: null,
    pipelineId: 'pipeline-001',
    probability: 50,
    stageId: 'stage-001',
    status: 'open',
    updatedAt: new Date('2025-01-15T10:00:00Z'),
    value: '10000.00',
    ...overrides,
  }
}

export function makeTag(overrides: Record<string, unknown> = {}) {
  return {
    color: '#8b5cf6',
    createdAt: new Date('2025-01-15T10:00:00Z'),
    id: 'tag-001',
    name: 'VIP',
    ...overrides,
  }
}

export function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: new Date('2025-01-15T10:00:00Z'),
    email: 'test@example.com',
    externalJanuaId: null,
    id: 'user-001',
    name: 'Test User',
    role: 'viewer',
    updatedAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  }
}

export function makeConversion(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: null,
    contactId: null,
    convertedAt: new Date('2025-01-15T10:00:00Z'),
    id: 'conv-001',
    leadId: null,
    metadata: null,
    opportunityId: null,
    type: 'visitor_to_lead',
    value: null,
    visitorSessionId: null,
    ...overrides,
  }
}

export function makeScoringRule(overrides: Record<string, unknown> = {}) {
  return {
    category: 'demographic',
    condition: { field: 'source', operator: 'eq', value: 'web' },
    createdAt: new Date('2025-01-15T10:00:00Z'),
    id: 'rule-001',
    isActive: true,
    name: 'Web source bonus',
    points: 10,
    updatedAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  }
}

export function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    budget: '5000.00',
    channel: 'email',
    createdAt: new Date('2025-01-15T10:00:00Z'),
    currency: 'USD',
    description: null,
    endDate: null,
    id: 'campaign-001',
    name: 'Test Campaign',
    offerId: null,
    spend: '2000.00',
    startDate: null,
    status: 'active',
    updatedAt: new Date('2025-01-15T10:00:00Z'),
    utmCampaign: null,
    utmMedium: null,
    utmSource: null,
    ...overrides,
  }
}

export function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: new Date('2025-01-15T10:00:00Z'),
    currency: 'USD',
    currentRedemptions: 0,
    description: null,
    externalProductId: null,
    externalProvider: null,
    id: 'offer-001',
    maxRedemptions: 100,
    name: 'Test Offer',
    status: 'active',
    type: 'discount',
    updatedAt: new Date('2025-01-15T10:00:00Z'),
    validFrom: null,
    validUntil: null,
    value: '50.00',
    ...overrides,
  }
}

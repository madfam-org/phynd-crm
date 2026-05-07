import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock modules — must be before imports
// ---------------------------------------------------------------------------

type MockQueryBuilder = {
  _result: unknown[]
  from: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  returning: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  then: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  values: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
}

const mockQb: MockQueryBuilder = {
  _result: [] as unknown[],
  from: vi.fn(),
  limit: vi.fn(),
  returning: vi.fn(),
  select: vi.fn(),
  set: vi.fn(),
  then: vi.fn(),
  update: vi.fn(),
  values: vi.fn(),
  where: vi.fn(),
}

for (const method of Object.keys(mockQb).filter((k) => k !== '_result' && k !== 'then')) {
  ;(mockQb as unknown as Record<string, ReturnType<typeof vi.fn>>)[method]?.mockReturnValue(mockQb)
}

const resetMockQueryThen = () => {
  mockQb.then.mockImplementation((resolve: (v: unknown) => void) =>
    Promise.resolve(mockQb._result).then(resolve),
  )
}

const mockDb = {
  select: vi.fn().mockReturnValue(mockQb),
  update: vi.fn().mockReturnValue(mockQb),
}

vi.mock('@phyne/db', () => ({
  getDb: vi.fn(() => mockDb),
}))

vi.mock('@phyne/db/schema', () => ({
  grantApplications: {
    complianceChecks: 'grantApplications.complianceChecks',
    id: 'grantApplications.id',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
}))

vi.mock('@phyne/logging', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { processGrantComplianceCheck } from '../processors/grant-compliance-check'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processGrantComplianceCheck', () => {
  const baseJob = {
    id: 'job-001',
    data: {
      grantApplicationId: 'grant-app-001',
      grantOpportunityId: 'grant-opp-001',
      fortunaGrantId: 'fortuna-123',
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.KARAFIEL_API_URL = 'http://karafiel:8000/api/v1'
    process.env.KARAFIEL_API_KEY = 'test-key'

    // Default: application exists
    mockQb._result = [
      {
        id: 'grant-app-001',
        applicationDraft: { rfc: 'RFC-12345' },
        complianceChecks: {},
      },
    ]
    resetMockQueryThen()
  })

  afterEach(() => {
    delete process.env.KARAFIEL_API_URL
    delete process.env.KARAFIEL_API_KEY
  })

  it('calls Karafiel compliance API and updates complianceChecks', async () => {
    const complianceResponse = {
      rfc_active: true,
      opinion_32d_positive: true,
      blacklisted: false,
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(complianceResponse),
    })

    let updateCallCount = 0
    mockQb.then.mockImplementation((resolve: (v: unknown) => void) => {
      updateCallCount++
      if (updateCallCount === 1) {
        // select returns existing application
        return Promise.resolve([
          { id: 'grant-app-001', applicationDraft: { rfc: 'RFC-12345' }, complianceChecks: {} },
        ]).then(resolve)
      }
      // update returns empty (we don't check the return)
      return Promise.resolve([]).then(resolve)
    })

    await processGrantComplianceCheck(baseJob as never)

    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockFetch.mock.calls[0]?.[0]).toContain('/grants/compliance-status/RFC-12345/')
    expect(mockDb.update).toHaveBeenCalled()
  })

  it('throws when Karafiel API is not configured', async () => {
    delete process.env.KARAFIEL_API_URL

    await expect(processGrantComplianceCheck(baseJob as never)).rejects.toThrow(
      'Karafiel API not configured',
    )
  })

  it('throws when Karafiel API returns non-200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    })

    let callCount = 0
    mockQb.then.mockImplementation((resolve: (v: unknown) => void) => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve([
          { id: 'grant-app-001', applicationDraft: {}, complianceChecks: {} },
        ]).then(resolve)
      }
      return Promise.resolve([]).then(resolve)
    })

    await expect(processGrantComplianceCheck(baseJob as never)).rejects.toThrow('status 500')
  })

  it('skips when application is not found', async () => {
    mockQb._result = []

    let callCount = 0
    mockQb.then.mockImplementation((resolve: (v: unknown) => void) => {
      callCount++
      return Promise.resolve([]).then(resolve)
    })

    await processGrantComplianceCheck(baseJob as never)

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('uses fortunaGrantId as RFC fallback when no RFC in metadata', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ rfc_active: true, opinion_32d_positive: false, blacklisted: false }),
    })

    let callCount = 0
    mockQb.then.mockImplementation((resolve: (v: unknown) => void) => {
      callCount++
      if (callCount === 1) {
        // Application without RFC in draft
        return Promise.resolve([
          { id: 'grant-app-001', applicationDraft: {}, complianceChecks: {} },
        ]).then(resolve)
      }
      return Promise.resolve([]).then(resolve)
    })

    await processGrantComplianceCheck(baseJob as never)

    expect(mockFetch.mock.calls[0]?.[0]).toContain('/grants/compliance-status/fortuna-123/')
  })
})

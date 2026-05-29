import { SERVICE_AUTH_SCOPES } from '@/lib/trpc/request-context'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock heavy dependencies
// ---------------------------------------------------------------------------

const mockCheckApiRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 199 })
vi.mock('@/lib/rate-limiter', () => ({
  checkApiRateLimit: (...args: unknown[]) => mockCheckApiRateLimit(...args),
}))

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/demo', () => ({
  DEMO_COOKIE_NAME: 'phynd-demo',
  getDemoSessionIdFromCookieHeader: vi.fn(() => null),
  createDemoAuth: vi.fn(() => ({
    userId: 'demo-test',
    tenantId: 'demo-test',
    roles: ['admin'],
    scopes: ['*'],
    accessToken: 'demo',
  })),
}))

const mockCreateServiceContext = vi.fn().mockReturnValue({
  db: {},
  cache: {},
  auth: { userId: '', tenantId: 'madfam', roles: [], scopes: [], accessToken: '' },
  tenantId: 'madfam',
})

type MockAuthContext = {
  userId: string
  tenantId: string
  roles: string[]
  scopes: string[]
  accessToken: string
}

function getServiceAuthContext(): MockAuthContext {
  const call = mockCreateServiceContext.mock.calls[0]
  expect(call).toBeDefined()
  return call?.[2] as MockAuthContext
}

vi.mock('@phynd/services/context', () => ({
  createServiceContext: (...args: unknown[]) => mockCreateServiceContext(...args),
}))

vi.mock('@phynd/db', () => ({
  getDb: vi.fn(() => ({})),
}))

const mockGetCacheManager = vi.fn(() => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  invalidate: vi.fn().mockResolvedValue(undefined),
}))

const mockGetFederationClients = vi.fn(() => ({}))
const mockGetHealthChecker = vi.fn(() => ({}))

vi.mock('@/lib/federation/clients', () => ({
  getCacheManager: () => mockGetCacheManager(),
  getFederationClients: () => mockGetFederationClients(),
  getHealthChecker: () => mockGetHealthChecker(),
}))

vi.mock('@phynd/logging', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

// Mock the tRPC fetchRequestHandler to intercept createContext calls
const mockFetchRequestHandler = vi.fn()
vi.mock('@trpc/server/adapters/fetch', () => ({
  fetchRequestHandler: (...args: unknown[]) => mockFetchRequestHandler(...args),
}))

vi.mock('@phynd/api/router', () => ({
  appRouter: {},
}))

// ---------------------------------------------------------------------------
// Tests — federation token auth for service-to-service tRPC calls
// ---------------------------------------------------------------------------

describe('tRPC route handler — federation token auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckApiRateLimit.mockResolvedValue({ allowed: true, remaining: 199 })
    mockFetchRequestHandler.mockImplementation(async (opts: Record<string, unknown>) => {
      // Call createContext to exercise the auth logic
      const createContext = opts.createContext as () => Promise<unknown>
      await createContext()
      return new Response(JSON.stringify({ result: { data: 'ok' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('creates SERVICE_AUTH context when valid federation token is provided', async () => {
    const token = 'test-federation-token-abc123'
    vi.stubEnv('FEDERATION_API_TOKEN', token)

    // Re-import to pick up the new env value
    vi.resetModules()

    // Re-register mocks after resetModules
    vi.doMock('@/lib/rate-limiter', () => ({
      checkApiRateLimit: (...args: unknown[]) => mockCheckApiRateLimit(...args),
    }))
    vi.doMock('@/lib/auth', () => ({
      auth: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('@/lib/demo', () => ({
      DEMO_COOKIE_NAME: 'phynd-demo',
      getDemoSessionIdFromCookieHeader: vi.fn(() => null),
      createDemoAuth: vi.fn(),
    }))
    vi.doMock('@phynd/services/context', () => ({
      createServiceContext: (...args: unknown[]) => mockCreateServiceContext(...args),
    }))
    vi.doMock('@phynd/db', () => ({ getDb: vi.fn(() => ({})) }))
    vi.doMock('@/lib/federation/clients', () => ({
      getCacheManager: () => mockGetCacheManager(),
      getFederationClients: () => mockGetFederationClients(),
      getHealthChecker: () => mockGetHealthChecker(),
    }))
    vi.doMock('@phynd/logging', () => ({
      createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    }))
    vi.doMock('@trpc/server/adapters/fetch', () => ({
      fetchRequestHandler: (...args: unknown[]) => mockFetchRequestHandler(...args),
    }))
    vi.doMock('@phynd/api/router', () => ({ appRouter: {} }))

    const { GET } = await import('@/app/api/trpc/[trpc]/route')

    const req = new Request('http://localhost/api/trpc/contacts.list', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })

    await GET(req)

    expect(mockCreateServiceContext).toHaveBeenCalledOnce()
    const authCtx = getServiceAuthContext()
    expect(authCtx).toEqual({
      userId: 'service:selva',
      tenantId: 'madfam',
      roles: ['service'],
      scopes: [...SERVICE_AUTH_SCOPES],
      accessToken: '',
    })
  })

  it('falls through to normal auth when Bearer token does not match', async () => {
    const token = 'test-federation-token-abc123'
    vi.stubEnv('FEDERATION_API_TOKEN', token)

    vi.resetModules()

    const mockAuth = vi.fn().mockResolvedValue(null)

    vi.doMock('@/lib/rate-limiter', () => ({
      checkApiRateLimit: (...args: unknown[]) => mockCheckApiRateLimit(...args),
    }))
    vi.doMock('@/lib/auth', () => ({ auth: mockAuth }))
    vi.doMock('@/lib/demo', () => ({
      DEMO_COOKIE_NAME: 'phynd-demo',
      getDemoSessionIdFromCookieHeader: vi.fn(() => null),
      createDemoAuth: vi.fn(),
    }))
    vi.doMock('@phynd/services/context', () => ({
      createServiceContext: (...args: unknown[]) => mockCreateServiceContext(...args),
    }))
    vi.doMock('@phynd/db', () => ({ getDb: vi.fn(() => ({})) }))
    vi.doMock('@/lib/federation/clients', () => ({
      getCacheManager: () => mockGetCacheManager(),
      getFederationClients: () => mockGetFederationClients(),
      getHealthChecker: () => mockGetHealthChecker(),
    }))
    vi.doMock('@phynd/logging', () => ({
      createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    }))
    vi.doMock('@trpc/server/adapters/fetch', () => ({
      fetchRequestHandler: (...args: unknown[]) => mockFetchRequestHandler(...args),
    }))
    vi.doMock('@phynd/api/router', () => ({ appRouter: {} }))

    const { GET } = await import('@/app/api/trpc/[trpc]/route')

    const req = new Request('http://localhost/api/trpc/contacts.list', {
      method: 'GET',
      headers: { Authorization: 'Bearer wrong-token' },
    })

    await GET(req)

    // Should have called auth() for session check instead of using SERVICE_AUTH
    expect(mockAuth).toHaveBeenCalledOnce()

    // createServiceContext should be called with an unauthenticated context (no session)
    expect(mockCreateServiceContext).toHaveBeenCalledOnce()
    const authCtx = getServiceAuthContext()
    expect(authCtx.userId).toBe('')
    expect(authCtx.roles).toEqual([])
  })

  it('falls through to normal auth when no Authorization header is present', async () => {
    const token = 'test-federation-token-abc123'
    vi.stubEnv('FEDERATION_API_TOKEN', token)

    vi.resetModules()

    const mockAuth = vi.fn().mockResolvedValue(null)

    vi.doMock('@/lib/rate-limiter', () => ({
      checkApiRateLimit: (...args: unknown[]) => mockCheckApiRateLimit(...args),
    }))
    vi.doMock('@/lib/auth', () => ({ auth: mockAuth }))
    vi.doMock('@/lib/demo', () => ({
      DEMO_COOKIE_NAME: 'phynd-demo',
      getDemoSessionIdFromCookieHeader: vi.fn(() => null),
      createDemoAuth: vi.fn(),
    }))
    vi.doMock('@phynd/services/context', () => ({
      createServiceContext: (...args: unknown[]) => mockCreateServiceContext(...args),
    }))
    vi.doMock('@phynd/db', () => ({ getDb: vi.fn(() => ({})) }))
    vi.doMock('@/lib/federation/clients', () => ({
      getCacheManager: () => mockGetCacheManager(),
      getFederationClients: () => mockGetFederationClients(),
      getHealthChecker: () => mockGetHealthChecker(),
    }))
    vi.doMock('@phynd/logging', () => ({
      createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    }))
    vi.doMock('@trpc/server/adapters/fetch', () => ({
      fetchRequestHandler: (...args: unknown[]) => mockFetchRequestHandler(...args),
    }))
    vi.doMock('@phynd/api/router', () => ({ appRouter: {} }))

    const { GET } = await import('@/app/api/trpc/[trpc]/route')

    const req = new Request('http://localhost/api/trpc/contacts.list', {
      method: 'GET',
    })

    await GET(req)

    expect(mockAuth).toHaveBeenCalledOnce()
    expect(mockCreateServiceContext).toHaveBeenCalledOnce()
    const authCtx = getServiceAuthContext()
    expect(authCtx.userId).toBe('')
  })

  it('falls through to normal auth when FEDERATION_API_TOKEN is not set', async () => {
    delete process.env.FEDERATION_API_TOKEN

    vi.resetModules()

    const mockAuth = vi.fn().mockResolvedValue(null)

    vi.doMock('@/lib/rate-limiter', () => ({
      checkApiRateLimit: (...args: unknown[]) => mockCheckApiRateLimit(...args),
    }))
    vi.doMock('@/lib/auth', () => ({ auth: mockAuth }))
    vi.doMock('@/lib/demo', () => ({
      DEMO_COOKIE_NAME: 'phynd-demo',
      getDemoSessionIdFromCookieHeader: vi.fn(() => null),
      createDemoAuth: vi.fn(),
    }))
    vi.doMock('@phynd/services/context', () => ({
      createServiceContext: (...args: unknown[]) => mockCreateServiceContext(...args),
    }))
    vi.doMock('@phynd/db', () => ({ getDb: vi.fn(() => ({})) }))
    vi.doMock('@/lib/federation/clients', () => ({
      getCacheManager: () => mockGetCacheManager(),
      getFederationClients: () => mockGetFederationClients(),
      getHealthChecker: () => mockGetHealthChecker(),
    }))
    vi.doMock('@phynd/logging', () => ({
      createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    }))
    vi.doMock('@trpc/server/adapters/fetch', () => ({
      fetchRequestHandler: (...args: unknown[]) => mockFetchRequestHandler(...args),
    }))
    vi.doMock('@phynd/api/router', () => ({ appRouter: {} }))

    const { GET } = await import('@/app/api/trpc/[trpc]/route')

    const req = new Request('http://localhost/api/trpc/contacts.list', {
      method: 'GET',
      headers: { Authorization: 'Bearer some-token' },
    })

    await GET(req)

    // Without FEDERATION_API_TOKEN set, even a Bearer token should fall through
    expect(mockAuth).toHaveBeenCalledOnce()
    expect(mockCreateServiceContext).toHaveBeenCalledOnce()
    const authCtx = getServiceAuthContext()
    expect(authCtx.userId).toBe('')
  })

  it('service auth context has scoped permissions (not admin)', async () => {
    const token = 'test-federation-token-abc123'
    vi.stubEnv('FEDERATION_API_TOKEN', token)

    vi.resetModules()

    vi.doMock('@/lib/rate-limiter', () => ({
      checkApiRateLimit: (...args: unknown[]) => mockCheckApiRateLimit(...args),
    }))
    vi.doMock('@/lib/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
    vi.doMock('@/lib/demo', () => ({
      DEMO_COOKIE_NAME: 'phynd-demo',
      getDemoSessionIdFromCookieHeader: vi.fn(() => null),
      createDemoAuth: vi.fn(),
    }))
    vi.doMock('@phynd/services/context', () => ({
      createServiceContext: (...args: unknown[]) => mockCreateServiceContext(...args),
    }))
    vi.doMock('@phynd/db', () => ({ getDb: vi.fn(() => ({})) }))
    vi.doMock('@/lib/federation/clients', () => ({
      getCacheManager: () => mockGetCacheManager(),
      getFederationClients: () => mockGetFederationClients(),
      getHealthChecker: () => mockGetHealthChecker(),
    }))
    vi.doMock('@phynd/logging', () => ({
      createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    }))
    vi.doMock('@trpc/server/adapters/fetch', () => ({
      fetchRequestHandler: (...args: unknown[]) => mockFetchRequestHandler(...args),
    }))
    vi.doMock('@phynd/api/router', () => ({ appRouter: {} }))

    const { GET } = await import('@/app/api/trpc/[trpc]/route')

    const req = new Request('http://localhost/api/trpc/leads.list', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })

    await GET(req)

    const authCtx = getServiceAuthContext()
    // Verify it does NOT have admin role or wildcard scope
    expect(authCtx.roles).not.toContain('admin')
    expect(authCtx.scopes).not.toContain('*')
    // Verify it has only the expected scopes
    expect(authCtx.scopes).toEqual([...SERVICE_AUTH_SCOPES])
    expect(authCtx.roles).toEqual(['service'])
  })

  it('rate limiting still applies to federation token requests', async () => {
    mockCheckApiRateLimit.mockResolvedValue({ allowed: false, remaining: 0 })

    const token = 'test-federation-token-abc123'
    vi.stubEnv('FEDERATION_API_TOKEN', token)

    vi.resetModules()

    vi.doMock('@/lib/rate-limiter', () => ({
      checkApiRateLimit: (...args: unknown[]) => mockCheckApiRateLimit(...args),
    }))
    vi.doMock('@/lib/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
    vi.doMock('@/lib/demo', () => ({
      DEMO_COOKIE_NAME: 'phynd-demo',
      getDemoSessionIdFromCookieHeader: vi.fn(() => null),
      createDemoAuth: vi.fn(),
    }))
    vi.doMock('@phynd/services/context', () => ({
      createServiceContext: (...args: unknown[]) => mockCreateServiceContext(...args),
    }))
    vi.doMock('@phynd/db', () => ({ getDb: vi.fn(() => ({})) }))
    vi.doMock('@/lib/federation/clients', () => ({
      getCacheManager: () => mockGetCacheManager(),
      getFederationClients: () => mockGetFederationClients(),
      getHealthChecker: () => mockGetHealthChecker(),
    }))
    vi.doMock('@phynd/logging', () => ({
      createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    }))
    vi.doMock('@trpc/server/adapters/fetch', () => ({
      fetchRequestHandler: (...args: unknown[]) => mockFetchRequestHandler(...args),
    }))
    vi.doMock('@phynd/api/router', () => ({ appRouter: {} }))

    const { GET } = await import('@/app/api/trpc/[trpc]/route')

    const req = new Request('http://localhost/api/trpc/contacts.list', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })

    const res = await GET(req)

    expect(res.status).toBe(429)
    // fetchRequestHandler should NOT have been called
    expect(mockFetchRequestHandler).not.toHaveBeenCalled()
  })
})

import type { AuthContext } from '@phynd/types/auth'
import { describe, expect, it } from 'vitest'
import { type ServiceContext, createServiceContext } from '../context'

// Lightweight mocks matching the real interfaces without importing heavy deps

const mockDb = {} as ServiceContext['db']

const mockCache = {} as ServiceContext['cache']

function createMockAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-001',
    tenantId: 'madfam',
    roles: ['admin'],
    scopes: ['read', 'write'],
    accessToken: 'tok_test_abc123',
    ...overrides,
  }
}

describe('createServiceContext', () => {
  it('returns an object with db, cache, auth, and tenantId properties', () => {
    const auth = createMockAuth()
    const ctx = createServiceContext(mockDb, mockCache, auth)

    expect(ctx).toHaveProperty('db')
    expect(ctx).toHaveProperty('cache')
    expect(ctx).toHaveProperty('auth')
    expect(ctx).toHaveProperty('tenantId')
  })

  it('passes through the exact db reference provided', () => {
    const auth = createMockAuth()
    const ctx = createServiceContext(mockDb, mockCache, auth)

    expect(ctx.db).toBe(mockDb)
  })

  it('passes through the exact cache reference provided', () => {
    const auth = createMockAuth()
    const ctx = createServiceContext(mockDb, mockCache, auth)

    expect(ctx.cache).toBe(mockCache)
  })

  it('passes through the exact auth object provided', () => {
    const auth = createMockAuth({
      userId: 'custom-user',
      roles: ['sales_rep'],
    })
    const ctx = createServiceContext(mockDb, mockCache, auth)

    expect(ctx.auth).toBe(auth)
    expect(ctx.auth.userId).toBe('custom-user')
    expect(ctx.auth.roles).toEqual(['sales_rep'])
  })

  it('defaults tenantId to "madfam" when auth does not override it', () => {
    const auth = createMockAuth()
    const ctx = createServiceContext(mockDb, mockCache, auth)

    expect(ctx.tenantId).toBe('madfam')
  })

  it('uses the tenantId from the auth context when provided', () => {
    const auth = createMockAuth({ tenantId: 'some-other-tenant' })
    const ctx = createServiceContext(mockDb, mockCache, auth)

    expect(ctx.tenantId).toBe('some-other-tenant')
  })

  it('returns exactly four properties (no extra fields)', () => {
    const auth = createMockAuth()
    const ctx = createServiceContext(mockDb, mockCache, auth)

    const keys = Object.keys(ctx)
    expect(keys).toHaveLength(4)
    expect(keys).toEqual(expect.arrayContaining(['db', 'cache', 'auth', 'tenantId']))
  })

  it('produces a context conforming to the ServiceContext interface', () => {
    const auth = createMockAuth()
    const ctx = createServiceContext(mockDb, mockCache, auth)

    // Type-level check backed by runtime structural assertion
    const satisfiesInterface: ServiceContext = ctx
    expect(satisfiesInterface).toBeDefined()
    expect(typeof satisfiesInterface.tenantId).toBe('string')
  })

  it('creates independent context objects on repeated calls', () => {
    const auth = createMockAuth()
    const ctx1 = createServiceContext(mockDb, mockCache, auth)
    const ctx2 = createServiceContext(mockDb, mockCache, auth)

    expect(ctx1).not.toBe(ctx2)
    expect(ctx1).toEqual(ctx2)
  })
})

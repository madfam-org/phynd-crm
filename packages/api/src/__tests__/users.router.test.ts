import type { ServiceContext } from '@phynd/services/context'
import type { AuthContext } from '@phynd/types/auth'
import { TRPCError } from '@trpc/server'
import { describe, expect, it, vi } from 'vitest'
import { appRouter } from '../router'
import { createCallerFactory } from '../trpc'

function createMockAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    accessToken: 'tok_test',
    roles: ['admin'],
    scopes: ['*'],
    tenantId: 'madfam',
    userId: 'user-001',
    ...overrides,
  }
}

function createMockCtx(authOverrides: Partial<AuthContext> = {}): ServiceContext {
  const qb = {
    _result: [] as unknown[],
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
    update: vi.fn(),
    values: vi.fn(),
    where: vi.fn(),
  }

  for (const method of Object.keys(qb).filter((k) => k !== '_result')) {
    ;(qb as unknown as Record<string, ReturnType<typeof vi.fn>>)[method]?.mockReturnValue(qb)
  }

  Object.defineProperty(qb, 'then', {
    value: vi.fn((resolve: (v: unknown) => void) => Promise.resolve(qb._result).then(resolve)),
    configurable: true,
    enumerable: false,
  })

  const db = {
    delete: vi.fn().mockReturnValue(qb),
    insert: vi.fn().mockReturnValue(qb),
    select: vi.fn().mockReturnValue(qb),
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(db)),
    update: vi.fn().mockReturnValue(qb),
  }

  return {
    auth: createMockAuth(authOverrides),
    cache: {
      delete: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
      invalidate: vi.fn(),
      set: vi.fn(),
    } as unknown as ServiceContext['cache'],
    db: db as unknown as ServiceContext['db'],
    tenantId: 'madfam',
  }
}

describe('users router', () => {
  const createCaller = createCallerFactory(appRouter)

  describe('admin access control', () => {
    it('rejects non-admin user with FORBIDDEN', async () => {
      const ctx = createMockCtx({ roles: ['viewer'] })
      const caller = createCaller(ctx)

      await expect(caller.users.list({})).rejects.toThrow(TRPCError)
      await expect(caller.users.list({})).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    })

    it('rejects sales_rep user with FORBIDDEN', async () => {
      const ctx = createMockCtx({ roles: ['sales_rep'] })
      const caller = createCaller(ctx)

      await expect(
        caller.users.getById({ id: '00000000-0000-0000-0000-000000000001' }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    })
  })

  describe('admin procedures', () => {
    it('list returns paginated users', async () => {
      const ctx = createMockCtx()
      const caller = createCaller(ctx)
      const result = await caller.users.list({})
      expect(result).toEqual({ hasMore: false, items: [], nextCursor: null })
    })

    it('list accepts cursor and limit', async () => {
      const ctx = createMockCtx()
      const caller = createCaller(ctx)
      const result = await caller.users.list({ cursor: 'abc', limit: 10 })
      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('hasMore')
    })

    it('getById accepts id', async () => {
      const ctx = createMockCtx()
      const caller = createCaller(ctx)
      const result = await caller.users.getById({
        id: '00000000-0000-0000-0000-000000000001',
      })
      // Mock returns [] so getById returns null
      expect(result).toBeNull()
    })

    it('create accepts email and optional name and role', async () => {
      const ctx = createMockCtx()
      const caller = createCaller(ctx)

      await expect(
        caller.users.create({
          email: 'new@example.com',
          name: 'New User',
          role: 'sales_rep',
        }),
      ).resolves.not.toThrow()
    })

    it('update accepts id with optional fields', async () => {
      const ctx = createMockCtx()
      const caller = createCaller(ctx)

      await expect(
        caller.users.update({
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Updated Name',
          role: 'manager',
        }),
      ).resolves.not.toThrow()
    })

    it('delete accepts id', async () => {
      const ctx = createMockCtx()
      const caller = createCaller(ctx)

      await expect(
        caller.users.delete({ id: '00000000-0000-0000-0000-000000000001' }),
      ).resolves.not.toThrow()
    })
  })
})

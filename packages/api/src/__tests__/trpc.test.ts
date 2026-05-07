import type { ServiceContext } from '@phyne/services/context'
import {
  ConflictError,
  FederationError,
  NotFoundError,
  ServiceError,
  ValidationError,
} from '@phyne/services/errors'
import type { AuthContext } from '@phyne/types/auth'
import { TRPCError } from '@trpc/server'
import { describe, expect, it } from 'vitest'
import {
  createCallerFactory,
  createTRPCContext,
  protectedProcedure,
  publicProcedure,
  router,
} from '../trpc'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

function createMockServiceContext(authOverrides: Partial<AuthContext> = {}): ServiceContext {
  return {
    db: {} as ServiceContext['db'],
    cache: {} as ServiceContext['cache'],
    auth: createMockAuth(authOverrides),
    tenantId: 'madfam',
  }
}

// ---------------------------------------------------------------------------
// createTRPCContext
// ---------------------------------------------------------------------------

describe('createTRPCContext', () => {
  it('returns the ServiceContext passed to it', () => {
    const svcCtx = createMockServiceContext()
    const trpcCtx = createTRPCContext(svcCtx)

    expect(trpcCtx).toBe(svcCtx)
  })

  it('preserves all ServiceContext properties', () => {
    const svcCtx = createMockServiceContext({ roles: ['sales_rep'] })
    const trpcCtx = createTRPCContext(svcCtx)

    expect(trpcCtx.tenantId).toBe('madfam')
    expect(trpcCtx.auth.roles).toEqual(['sales_rep'])
    expect(trpcCtx.db).toBeDefined()
    expect(trpcCtx.cache).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Auth middleware (protectedProcedure)
// ---------------------------------------------------------------------------

describe('protectedProcedure auth middleware', () => {
  // Create a minimal router to exercise the middleware
  const testRouter = router({
    protectedEndpoint: protectedProcedure.query(({ ctx }) => {
      return { userId: ctx.auth.userId, tenantId: ctx.tenantId }
    }),
    publicEndpoint: publicProcedure.query(() => {
      return { status: 'ok' }
    }),
  })

  const createCaller = createCallerFactory(testRouter)

  it('allows access when userId is present in auth context', async () => {
    const ctx = createMockServiceContext({ userId: 'user-123' })
    const caller = createCaller(ctx)

    const result = await caller.protectedEndpoint()

    expect(result.userId).toBe('user-123')
    expect(result.tenantId).toBe('madfam')
  })

  it('throws UNAUTHORIZED when userId is empty string', async () => {
    const ctx = createMockServiceContext({ userId: '' })
    const caller = createCaller(ctx)

    await expect(caller.protectedEndpoint()).rejects.toThrow(TRPCError)
    await expect(caller.protectedEndpoint()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })

  it('allows public procedures regardless of auth state', async () => {
    const ctx = createMockServiceContext({ userId: '' })
    const caller = createCaller(ctx)

    const result = await caller.publicEndpoint()
    expect(result.status).toBe('ok')
  })

  it('passes the full context through to the handler on success', async () => {
    const ctx = createMockServiceContext({
      userId: 'full-ctx-user',
      roles: ['admin', 'sales_manager'],
    })
    const caller = createCaller(ctx)

    const result = await caller.protectedEndpoint()
    expect(result.userId).toBe('full-ctx-user')
  })
})

describe('protectedProcedure service auth scopes', () => {
  it('allows service callers with matching read scope for query procedures', async () => {
    const serviceQueryRouter = router({
      leads: router({
        list: protectedProcedure.query(() => ({ ok: true })),
      }),
    })
    const createCaller = createCallerFactory(serviceQueryRouter)
    const caller = createCaller(
      createMockServiceContext({
        userId: 'service:autoswarm',
        roles: ['service'],
        scopes: ['leads:read'],
      }),
    )

    const result = await caller.leads.list()
    expect(result).toEqual({ ok: true })
  })

  it('forbids service callers without matching scope', async () => {
    const serviceQueryRouter = router({
      leads: router({
        list: protectedProcedure.query(() => ({ ok: true })),
      }),
    })
    const createCaller = createCallerFactory(serviceQueryRouter)
    const caller = createCaller(
      createMockServiceContext({
        userId: 'service:autoswarm',
        roles: ['service'],
        scopes: ['contacts:read'],
      }),
    )

    await expect(caller.leads.list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('forbids service callers writing outside `...:write` scope', async () => {
    const serviceMutationRouter = router({
      leads: router({
        create: protectedProcedure.mutation(() => ({ ok: true })),
      }),
    })
    const createCaller = createCallerFactory(serviceMutationRouter)
    const caller = createCaller(
      createMockServiceContext({
        userId: 'service:autoswarm',
        roles: ['service'],
        scopes: ['leads:read'],
      }),
    )

    await expect(caller.leads.create()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})

// ---------------------------------------------------------------------------
// requireRole middleware
// ---------------------------------------------------------------------------

describe('requireRole middleware', () => {
  // Import requireRole separately since it is not in the public re-export
  // but we can test it via a router definition
  let requireRole: typeof import('../trpc').requireRole

  beforeAll(async () => {
    const mod = await import('../trpc')
    requireRole = mod.requireRole
  })

  it('allows access when user has one of the required roles', async () => {
    const roleRouter = router({
      adminOnly: protectedProcedure
        .use(requireRole?.('admin'))
        .query(() => ({ access: 'granted' })),
    })
    const createCaller = createCallerFactory(roleRouter)
    const ctx = createMockServiceContext({ userId: 'u1', roles: ['admin'] })
    const caller = createCaller(ctx)

    const result = await caller.adminOnly()
    expect(result.access).toBe('granted')
  })

  it('allows access when user has any one of multiple required roles', async () => {
    const roleRouter = router({
      salesOrAdmin: protectedProcedure
        .use(requireRole?.('admin', 'sales_manager'))
        .query(() => ({ access: 'granted' })),
    })
    const createCaller = createCallerFactory(roleRouter)
    const ctx = createMockServiceContext({
      userId: 'u1',
      roles: ['sales_manager'],
    })
    const caller = createCaller(ctx)

    const result = await caller.salesOrAdmin()
    expect(result.access).toBe('granted')
  })

  it('throws FORBIDDEN when user lacks all required roles', async () => {
    const roleRouter = router({
      adminOnly: protectedProcedure
        .use(requireRole?.('admin'))
        .query(() => ({ access: 'granted' })),
    })
    const createCaller = createCallerFactory(roleRouter)
    const ctx = createMockServiceContext({ userId: 'u1', roles: ['viewer'] })
    const caller = createCaller(ctx)

    await expect(caller.adminOnly()).rejects.toThrow(TRPCError)
    await expect(caller.adminOnly()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('includes the required roles in the FORBIDDEN error message', async () => {
    const roleRouter = router({
      restricted: protectedProcedure
        .use(requireRole?.('admin', 'sales_manager'))
        .query(() => ({ access: 'granted' })),
    })
    const createCaller = createCallerFactory(roleRouter)
    const ctx = createMockServiceContext({ userId: 'u1', roles: ['viewer'] })
    const caller = createCaller(ctx)

    try {
      await caller.restricted()
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError)
      const trpcErr = err as TRPCError
      expect(trpcErr.message).toContain('admin')
      expect(trpcErr.message).toContain('sales_manager')
    }
  })

  it('throws UNAUTHORIZED before FORBIDDEN when userId is empty', async () => {
    const roleRouter = router({
      adminOnly: protectedProcedure
        .use(requireRole?.('admin'))
        .query(() => ({ access: 'granted' })),
    })
    const createCaller = createCallerFactory(roleRouter)
    const ctx = createMockServiceContext({ userId: '', roles: ['admin'] })
    const caller = createCaller(ctx)

    // The auth middleware runs first, so it should be UNAUTHORIZED
    await expect(caller.adminOnly()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })
})

// ---------------------------------------------------------------------------
// ServiceError → tRPC error mapping
// ---------------------------------------------------------------------------

describe('ServiceError → tRPC error mapping', () => {
  it('maps NotFoundError to NOT_FOUND', async () => {
    const errorRouter = router({
      failing: publicProcedure.query(() => {
        throw new NotFoundError('Contact', 'c-123')
      }),
    })
    const caller = createCallerFactory(errorRouter)(createMockServiceContext())

    await expect(caller.failing()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Contact not found: c-123',
    })
  })

  it('maps ValidationError to BAD_REQUEST', async () => {
    const errorRouter = router({
      failing: publicProcedure.query(() => {
        throw new ValidationError('Email is required')
      }),
    })
    const caller = createCallerFactory(errorRouter)(createMockServiceContext())

    await expect(caller.failing()).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Email is required',
    })
  })

  it('maps ConflictError to CONFLICT', async () => {
    const errorRouter = router({
      failing: publicProcedure.query(() => {
        throw new ConflictError('Duplicate entry')
      }),
    })
    const caller = createCallerFactory(errorRouter)(createMockServiceContext())

    await expect(caller.failing()).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Duplicate entry',
    })
  })

  it('maps FederationError to INTERNAL_SERVER_ERROR', async () => {
    const errorRouter = router({
      failing: publicProcedure.query(() => {
        throw new FederationError('janua', 'Connection refused')
      }),
    })
    const caller = createCallerFactory(errorRouter)(createMockServiceContext())

    await expect(caller.failing()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Federation error (janua): Connection refused',
    })
  })

  it('maps generic ServiceError to INTERNAL_SERVER_ERROR', async () => {
    const errorRouter = router({
      failing: publicProcedure.query(() => {
        throw new ServiceError('Unknown service error', 'UNKNOWN_CODE', 500)
      }),
    })
    const caller = createCallerFactory(errorRouter)(createMockServiceContext())

    await expect(caller.failing()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unknown service error',
    })
  })

  it('passes non-ServiceError through unchanged', async () => {
    const errorRouter = router({
      failing: publicProcedure.query(() => {
        throw new Error('plain error')
      }),
    })
    const caller = createCallerFactory(errorRouter)(createMockServiceContext())

    await expect(caller.failing()).rejects.toThrow('plain error')
  })

  it('works on protectedProcedure too', async () => {
    const errorRouter = router({
      failing: protectedProcedure.query(() => {
        throw new NotFoundError('Lead', 'l-456')
      }),
    })
    const ctx = createMockServiceContext({ userId: 'user-1' })
    const caller = createCallerFactory(errorRouter)(ctx)

    await expect(caller.failing()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Lead not found: l-456',
    })
  })
})

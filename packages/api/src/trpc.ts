import type { ServiceContext } from '@phyne/services/context'
import type { AuthContext } from '@phyne/types/auth'
import { TRPCError, initTRPC } from '@trpc/server'
import superjson from 'superjson'

export const createTRPCContext = (ctx: ServiceContext) => ctx

export type TRPCContext = ServiceContext

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
})

export const router = t.router
export const createCallerFactory = t.createCallerFactory

// ServiceError → TRPCError code mapping
const serviceErrorToTrpcCode: Record<string, TRPCError['code']> = {
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'BAD_REQUEST',
  CONFLICT: 'CONFLICT',
  FEDERATION_ERROR: 'INTERNAL_SERVER_ERROR',
}

const serviceErrorNames = new Set([
  'ServiceError',
  'NotFoundError',
  'ValidationError',
  'ConflictError',
  'FederationError',
])

function isServiceError(err: unknown): err is Error & { code: string } {
  return (
    err instanceof Error &&
    serviceErrorNames.has(err.name) &&
    'code' in err &&
    typeof (err as unknown as Record<string, unknown>).code === 'string'
  )
}

// Error-mapping middleware — translates ServiceError subclasses into proper TRPCErrors.
// In tRPC v11, next() returns { ok: false, error } instead of throwing.
// The original error is in result.error.cause.
const handleServiceErrors = t.middleware(async ({ next }) => {
  const result = await next()

  if (!result.ok) {
    const cause = result.error.cause
    if (isServiceError(cause)) {
      throw new TRPCError({
        code: serviceErrorToTrpcCode[cause.code] ?? 'INTERNAL_SERVER_ERROR',
        message: cause.message,
        cause,
      })
    }
  }

  return result
})

const baseProcedure = t.procedure.use(handleServiceErrors)

export const publicProcedure = baseProcedure

// Auth middleware - ensures user is authenticated
const enforceAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.auth.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({ ctx })
})

function isServiceAuth(auth: AuthContext) {
  return auth.roles.includes('service') || auth.userId.startsWith('service:')
}

function requiredScopeFromPath(path: string, procedureType: string | undefined): string {
  const [resource] = path.split('.')
  const normalizedResource = resource || 'global'
  const action = procedureType === 'query' || procedureType === 'subscription' ? 'read' : 'write'
  return `${normalizedResource}:${action}`
}

function hasRequiredScope(scopes: string[], requiredScope: string): boolean {
  const [resource] = requiredScope.split(':')
  return (
    scopes.includes('*') ||
    scopes.includes(requiredScope) ||
    scopes.includes(`${resource}:*`)
  )
}

// Service auth is least-privilege by default. Requires explicit scope matches
// (for non-service identities, scope checks are not enforced).
const enforceServiceScopes = t.middleware(({ ctx, path, type, next }) => {
  if (isServiceAuth(ctx.auth) && !ctx.auth.roles.includes('admin')) {
    const requiredScope = requiredScopeFromPath(path, type)
    if (!hasRequiredScope(ctx.auth.scopes, requiredScope)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Missing scope: ${requiredScope}`,
      })
    }
  }

  return next({ ctx })
})

export const protectedProcedure = baseProcedure.use(enforceAuth).use(enforceServiceScopes)

// Role middleware factory
export function requireRole(...roles: string[]) {
  return t.middleware(({ ctx, next }) => {
    const hasRole = ctx.auth.roles.some((r) => roles.includes(r))
    if (!hasRole) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Requires one of: ${roles.join(', ')}`,
      })
    }
    return next({ ctx })
  })
}

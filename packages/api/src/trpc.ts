import type { ServiceContext } from '@phyne/services/context'
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

export const protectedProcedure = baseProcedure.use(enforceAuth)

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

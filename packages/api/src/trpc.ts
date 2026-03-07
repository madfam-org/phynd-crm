import type { ServiceContext } from '@phyne/services/context'
import { TRPCError, initTRPC } from '@trpc/server'
import superjson from 'superjson'

export const createTRPCContext = (ctx: ServiceContext) => ctx

export type TRPCContext = ServiceContext

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
})

export const router = t.router
export const publicProcedure = t.procedure
export const createCallerFactory = t.createCallerFactory

// Auth middleware - ensures user is authenticated
const enforceAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.auth.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({ ctx })
})

export const protectedProcedure = t.procedure.use(enforceAuth)

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

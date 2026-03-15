import { auth } from '@/lib/auth'
import { DEMO_COOKIE_NAME, createDemoAuth } from '@/lib/demo'
import { getCacheManager, getFederationClients, getHealthChecker } from '@/lib/federation/clients'
import { checkApiRateLimit } from '@/lib/rate-limiter'
import { appRouter } from '@phyne/api/router'
import { getDb } from '@phyne/db'
import { createServiceContext } from '@phyne/services/context'
import type { AuthContext } from '@phyne/types/auth'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'

const DEV_BYPASS = process.env.NODE_ENV === 'development' && process.env.AUTH_BYPASS === 'true'

const DEV_AUTH: AuthContext = {
  userId: 'dev-user',
  tenantId: 'madfam',
  roles: ['admin'],
  scopes: ['*'],
  accessToken: 'dev-token',
}

function getDemoSessionId(req: Request): string | null {
  const cookieHeader = req.headers.get('cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`${DEMO_COOKIE_NAME}=([^;]+)`))
  return match?.[1] ?? null
}

const handler = async (req: Request) => {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
  const { allowed } = await checkApiRateLimit(ip)
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    })
  }

  const demoSessionId = getDemoSessionId(req)

  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: async () => {
      const session = await auth()

      let authCtx: AuthContext
      if (session?.user) {
        authCtx = {
          userId: session.user.id ?? '',
          tenantId: 'madfam',
          roles: session.user.roles ?? [],
          scopes: session.user.scopes ?? [],
          accessToken: session.accessToken ?? '',
        }
      } else if (DEV_BYPASS) {
        authCtx = DEV_AUTH
      } else if (demoSessionId) {
        authCtx = createDemoAuth(demoSessionId)
      } else {
        authCtx = {
          userId: '',
          tenantId: 'madfam',
          roles: [],
          scopes: [],
          accessToken: '',
        }
      }

      const db = getDb()
      const cache = getCacheManager()
      const ctx = createServiceContext(db, cache, authCtx)

      return {
        ...ctx,
        federation: {
          clients: getFederationClients(),
          healthChecker: getHealthChecker(),
        },
      }
    },
  })
}

export { handler as GET, handler as POST }

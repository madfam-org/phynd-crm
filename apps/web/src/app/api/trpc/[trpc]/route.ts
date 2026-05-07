import crypto from 'node:crypto'
import { auth } from '@/lib/auth'
import { DEMO_COOKIE_NAME, createDemoAuth } from '@/lib/demo'
import { getCacheManager, getFederationClients, getHealthChecker } from '@/lib/federation/clients'
import { checkApiRateLimit } from '@/lib/rate-limiter'
import { appRouter } from '@phyne/api/router'
import { DEFAULT_TENANT_ID } from '@phyne/config/constants'
import { getDb } from '@phyne/db'
import { createServiceContext } from '@phyne/services/context'
import type { AuthContext } from '@phyne/types/auth'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'

function assertAuthBypassNotEnabled() {
  if (process.env.NODE_ENV === 'production' && process.env.AUTH_BYPASS === 'true') {
    throw new Error('AUTH_BYPASS must not be enabled in production')
  }
}

const DEV_BYPASS = process.env.NODE_ENV === 'development' && process.env.AUTH_BYPASS === 'true'
const FEDERATION_TOKEN = process.env.FEDERATION_API_TOKEN ?? ''

const DEV_AUTH: AuthContext = {
  userId: 'dev-user',
  tenantId: DEFAULT_TENANT_ID,
  roles: ['admin'],
  scopes: ['*'],
  accessToken: process.env.DEV_ACCESS_TOKEN || crypto.randomUUID(),
}

const SERVICE_AUTH: AuthContext = {
  userId: 'service:autoswarm',
  tenantId: DEFAULT_TENANT_ID,
  roles: ['service'],
  scopes: ['leads:read', 'activities:read'],
  accessToken: '',
}

function getDemoSessionId(req: Request): string | null {
  const cookieHeader = req.headers.get('cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`${DEMO_COOKIE_NAME}=([^;]+)`))
  return match?.[1] ?? null
}

const handler = async (req: Request) => {
  assertAuthBypassNotEnabled()

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
      // Service-to-service auth via federation token
      const authHeader = req.headers.get('authorization') ?? ''
      if (FEDERATION_TOKEN && authHeader === `Bearer ${FEDERATION_TOKEN}`) {
        const db = getDb()
        const cache = getCacheManager()
        const ctx = createServiceContext(db, cache, SERVICE_AUTH)
        return {
          ...ctx,
          federation: { clients: getFederationClients(), healthChecker: getHealthChecker() },
        }
      }

      const session = await auth()

      let authCtx: AuthContext
      if (session?.user) {
        authCtx = {
          userId: session.user.id ?? '',
          tenantId: DEFAULT_TENANT_ID,
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
          tenantId: DEFAULT_TENANT_ID,
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

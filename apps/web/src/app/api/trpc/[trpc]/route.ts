import { auth } from '@/lib/auth'
import { DEMO_COOKIE_NAME } from '@/lib/demo'
import { getCacheManager, getFederationClients, getHealthChecker } from '@/lib/federation/clients'
import { resolveTenantIdFromHeaders } from '@/lib/http/tenant-context'
import { checkApiRateLimit } from '@/lib/rate-limiter'
import { createAppContext, createServiceAuth, resolveAuthContext } from '@/lib/trpc/request-context'
import { appRouter } from '@phynd/api/router'
import { createLogger } from '@phynd/logging'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'

const logger = createLogger('web:trpc:service-auth')

function assertAuthBypassNotEnabled() {
  if (process.env.NODE_ENV === 'production' && process.env.AUTH_BYPASS === 'true') {
    throw new Error('AUTH_BYPASS must not be enabled in production')
  }
}

const FEDERATION_TOKEN = process.env.FEDERATION_API_TOKEN ?? ''

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
      const authHeader = req.headers.get('authorization') ?? ''
      if (FEDERATION_TOKEN && authHeader === `Bearer ${FEDERATION_TOKEN}`) {
        const tenantId = resolveTenantIdFromHeaders(req.headers)
        const authCtx = createServiceAuth(tenantId)
        logger.info(
          {
            event: 'service_auth',
            userId: authCtx.userId,
            tenantId,
            path: new URL(req.url).pathname,
            ip,
          },
          'Service token authenticated',
        )
        return createAppContext(authCtx)
      }

      const authCtx = await resolveAuthContext(req.headers, { demoSessionId })
      return createAppContext(authCtx)
    },
  })
}

export { handler as GET, handler as POST }

import { checkApiRateLimit } from '@/lib/rate-limiter'
import { createAppContextFromRequest } from '@/lib/trpc/request-context'
import { appRouter } from '@phynd/api/router'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'

function assertAuthBypassNotEnabled() {
  if (process.env.NODE_ENV === 'production' && process.env.AUTH_BYPASS === 'true') {
    throw new Error('AUTH_BYPASS must not be enabled in production')
  }
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

  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: async () => createAppContextFromRequest(req, 'trpc'),
  })
}

export { handler as GET, handler as POST }

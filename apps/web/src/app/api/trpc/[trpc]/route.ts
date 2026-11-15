import { clientAddress } from '@/lib/client-address'
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

  const ip = clientAddress(req.headers)
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

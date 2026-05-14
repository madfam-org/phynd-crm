import { auth } from '@/lib/auth'
import { getCacheManager, getFederationClients, getHealthChecker } from '@/lib/federation/clients'
import { schema } from '@phynd/api'
import { getDb } from '@phynd/db'
import { createServiceContext } from '@phynd/services/context'
import { createYoga } from 'graphql-yoga'

const { handleRequest } = createYoga({
  schema: schema as any,
  // Define standard context injection matching ServiceContext
  context: async (req) => {
    // Determine tenantId from headers or host for multi-tenancy Phase 3
    const host = req.request.headers.get('host') || ''
    // Assuming subdomain as tenant ID (e.g. madfam.phynd.app), defaulting to madfam
    const subdomain = host.split('.')[0]
    const tenantId =
      subdomain !== 'app' && subdomain !== 'api' && subdomain !== 'localhost:3000'
        ? subdomain
        : 'madfam'

    const session = await auth()
    const authCtx = {
      userId: session?.user?.id ?? '',
      tenantId,
      roles: session?.user?.roles ?? [],
      scopes: session?.user?.scopes ?? [],
      accessToken: session?.accessToken ?? '',
    } as any

    const db = getDb(tenantId)
    const cache = getCacheManager()

    return {
      ...createServiceContext(db, cache, authCtx, tenantId),
      federation: {
        clients: getFederationClients(),
        healthChecker: getHealthChecker(),
      },
    }
  },
  // Ensure Next.js can handle standard web request
  fetchAPI: { Response },
  graphqlEndpoint: '/api/graphql',
})

export function GET(request: Request) {
  return handleRequest(request, {})
}

export function POST(request: Request) {
  return handleRequest(request, {})
}

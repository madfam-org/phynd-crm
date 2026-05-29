import { auth } from '@/lib/auth'
import { resolveTenantIdFromHeaders } from '@/lib/http/tenant-context'
import { createAppContext } from '@/lib/trpc/request-context'
import { schema } from '@phynd/api'
import type { AuthContext } from '@phynd/types/auth'
import type { GraphQLSchema } from 'graphql'
import { createYoga } from 'graphql-yoga'

type PhyndSession = {
  user?: {
    id?: string
    roles?: string[]
    scopes?: string[]
  }
  accessToken?: string
}

const { handleRequest } = createYoga({
  schema: schema as GraphQLSchema,
  // Define standard context injection matching ServiceContext
  context: async (req) => {
    const tenantId = resolveTenantIdFromHeaders(req.request.headers)

    const session = (await auth()) as PhyndSession | null
    const authCtx: AuthContext = {
      userId: session?.user?.id ?? '',
      tenantId,
      roles: session?.user?.roles ?? [],
      scopes: session?.user?.scopes ?? [],
      accessToken: session?.accessToken ?? '',
    }

    return createAppContext(authCtx)
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

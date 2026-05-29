import { checkApiRateLimit } from '@/lib/rate-limiter'
import { createAppContextFromRequest } from '@/lib/trpc/request-context'
import { schema } from '@phynd/api'
import type { GraphQLSchema } from 'graphql'
import { createYoga } from 'graphql-yoga'

const { handleRequest } = createYoga({
  schema: schema as GraphQLSchema,
  context: async ({ request }) => createAppContextFromRequest(request, 'graphql'),
  fetchAPI: { Response },
  graphqlEndpoint: '/api/graphql',
})

async function withRateLimit(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
  const { allowed } = await checkApiRateLimit(ip)
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    })
  }
  return handleRequest(request, {})
}

export function GET(request: Request) {
  return withRateLimit(request)
}

export function POST(request: Request) {
  return withRateLimit(request)
}

import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '@phyne/api/router'
import type { ServiceContext } from '@phyne/services/context'

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: (): ServiceContext => {
      // TODO: Wire real db, cache, and auth from session
      return {
        db: {} as any,
        cache: {} as any,
        auth: {
          userId: 'dev-user',
          tenantId: 'madfam',
          roles: ['admin'],
          scopes: ['*'],
          accessToken: '',
        },
        tenantId: 'madfam',
      }
    },
  })

export { handler as GET, handler as POST }

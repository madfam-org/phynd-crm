import { auth } from '@/lib/auth'
import { getCacheManager, getFederationClients, getHealthChecker } from '@/lib/federation/clients'
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

const handler = (req: Request) =>
  fetchRequestHandler({
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

export { handler as GET, handler as POST }

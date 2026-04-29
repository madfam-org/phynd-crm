import 'server-only'
import crypto from 'node:crypto'
import { auth } from '@/lib/auth'
import { createDemoAuth, isDemoSession } from '@/lib/demo'
import { getCacheManager, getFederationClients, getHealthChecker } from '@/lib/federation/clients'
import { createCallerFactory } from '@phyne/api'
import { appRouter } from '@phyne/api/router'
import { DEFAULT_TENANT_ID } from '@phyne/config/constants'
import { getDb } from '@phyne/db'
import { createServiceContext } from '@phyne/services/context'
import type { AuthContext } from '@phyne/types/auth'
import { cookies } from 'next/headers'

export const createCaller = createCallerFactory(appRouter)

if (process.env.NODE_ENV === 'production' && process.env.AUTH_BYPASS === 'true') {
  throw new Error('AUTH_BYPASS must not be enabled in production')
}

const DEV_BYPASS = process.env.NODE_ENV === 'development' && process.env.AUTH_BYPASS === 'true'

const DEV_AUTH: AuthContext = {
  userId: 'dev-user',
  tenantId: DEFAULT_TENANT_ID,
  roles: ['admin'],
  scopes: ['*'],
  accessToken: process.env.DEV_ACCESS_TOKEN || crypto.randomUUID(),
}

export async function getServerCaller() {
  const session = await auth()
  const cookieStore = await cookies()
  const demoSessionId = isDemoSession(cookieStore)

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

  return createCaller({
    ...ctx,
    federation: {
      clients: getFederationClients(),
      healthChecker: getHealthChecker(),
    },
  })
}

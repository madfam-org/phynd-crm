import crypto from 'node:crypto'
import { auth } from '@/lib/auth'
import { createDemoAuth } from '@/lib/demo'
import { getCacheManager, getFederationClients, getHealthChecker } from '@/lib/federation/clients'
import { resolveTenantIdFromHeaders } from '@/lib/http/tenant-context'
import { createCallerFactory } from '@phynd/api'
import { appRouter } from '@phynd/api/router'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { resolveFederationServiceUserId } from '@phynd/config/service-auth'
import { getDb } from '@phynd/db'
import { createServiceContext } from '@phynd/services/context'
import type { AuthContext } from '@phynd/types/auth'

export const createCaller = createCallerFactory(appRouter)

const DEV_BYPASS = process.env.NODE_ENV === 'development' && process.env.AUTH_BYPASS === 'true'

export const DEV_AUTH: AuthContext = {
  userId: 'dev-user',
  tenantId: DEFAULT_TENANT_ID,
  roles: ['admin'],
  scopes: ['*'],
  accessToken: process.env.DEV_ACCESS_TOKEN || crypto.randomUUID(),
}

/** Scopes for Selva / AutoSwarm service-to-service reads (expand in Phase 5). */
export const SERVICE_AUTH_SCOPES = [
  'leads:read',
  'activities:read',
  'contacts:read',
  'opportunities:read',
  'unifiedProfile:read',
  'engagements:read',
  'search:read',
  'analytics:read',
  'aiKanban:write',
] as const

export function createServiceAuth(tenantId: string): AuthContext {
  return {
    userId: resolveFederationServiceUserId(),
    tenantId,
    roles: ['service'],
    scopes: [...SERVICE_AUTH_SCOPES],
    accessToken: '',
  }
}

export const EMPTY_AUTH: AuthContext = {
  userId: '',
  tenantId: DEFAULT_TENANT_ID,
  roles: [],
  scopes: [],
  accessToken: '',
}

export async function resolveAuthContext(
  headers: Headers,
  options?: { demoSessionId?: string | null },
): Promise<AuthContext> {
  const tenantId = resolveTenantIdFromHeaders(headers)
  const demoSessionId = options?.demoSessionId ?? null

  const session = await auth()
  if (session?.user) {
    return {
      userId: session.user.id ?? '',
      tenantId,
      roles: session.user.roles ?? [],
      scopes: session.user.scopes ?? [],
      accessToken: session.accessToken ?? '',
    }
  }
  if (DEV_BYPASS) {
    return { ...DEV_AUTH, tenantId }
  }
  if (demoSessionId) {
    return createDemoAuth(demoSessionId)
  }
  return { ...EMPTY_AUTH, tenantId }
}

export function createAppContext(authCtx: AuthContext) {
  const db = getDb(authCtx.tenantId)
  const cache = getCacheManager()
  const ctx = createServiceContext(db, cache, authCtx, authCtx.tenantId)

  return {
    ...ctx,
    federation: {
      clients: getFederationClients(),
      healthChecker: getHealthChecker(),
    },
  }
}

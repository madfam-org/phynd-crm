import crypto from 'node:crypto'
import { auth } from '@/lib/auth'
import { createDemoAuth, getDemoSessionIdFromCookieHeader } from '@/lib/demo'
import { getCacheManager, getFederationClients, getHealthChecker } from '@/lib/federation/clients'
import { resolveTenantIdFromHeaders } from '@/lib/http/tenant-context'
import { createCallerFactory } from '@phynd/api'
import { appRouter } from '@phynd/api/router'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { resolveFederationServiceUserId } from '@phynd/config/service-auth'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { UsersService } from '@phynd/services'
import { createServiceContext } from '@phynd/services/context'
import { crmUserResolver } from '@phynd/services/identity'
import type { AuthContext } from '@phynd/types/auth'

const serviceAuthLogger = createLogger('web:trpc:service-auth')
const staffGateLogger = createLogger('web:trpc:staff-gate')
const FEDERATION_TOKEN = process.env.FEDERATION_API_TOKEN ?? ''

export const createCaller = createCallerFactory(appRouter)

const DEV_BYPASS = process.env.NODE_ENV === 'development' && process.env.AUTH_BYPASS === 'true'

export const DEV_AUTH: AuthContext = {
  userId: 'dev-user',
  tenantId: DEFAULT_TENANT_ID,
  roles: ['admin'],
  scopes: ['*'],
  accessToken: process.env.DEV_ACCESS_TOKEN || crypto.randomUUID(),
}

/** Scopes for Selva / Selva service-to-service reads (expand in Phase 5). */
export const SERVICE_AUTH_SCOPES = [
  'leads:read',
  'activities:read',
  'contacts:read',
  'opportunities:read',
  'unifiedProfile:read',
  'engagements:read',
  'search:read',
  'analytics:read',
  'federationHealth:read',
  'aiKanban:write',
  // Campaign authorization review surface relayed through Selva. The write
  // scope only reaches `campaignAuthorizations.decide/request` — the decision
  // is still recorded in phynd's audit ledger with the asserted operator
  // identity, and the send gate itself lives here, not in Selva.
  'campaignAuthorizations:read',
  'campaignAuthorizations:write',
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

/**
 * Staff gate. A signed-in Janua account reaches the CRM only when it is linked
 * to a CRM user (`users.external_janua_id`); any other account is treated as
 * signed out. PHYND_ALLOW_UNLINKED_SIGNIN="true" lifts the gate for one
 * deployment, as a break-glass while a staff account is being linked.
 */
export function allowUnlinkedSignIn(): boolean {
  return process.env.PHYND_ALLOW_UNLINKED_SIGNIN === 'true'
}

/**
 * First-admin bootstrap. PHYND_BOOTSTRAP_ADMIN_SUBS lists Janua subjects
 * (comma-separated, exact) that are provisioned as CRM admins on sign-in when
 * they have no CRM user yet, so the first administrator can get in once the
 * staff gate is on. Every other unlinked account still has no access. Take the
 * subject off the list once its account is linked.
 */
export function bootstrapAdminSubjects(): Set<string> {
  return new Set(
    (process.env.PHYND_BOOTSTRAP_ADMIN_SUBS ?? '')
      .split(',')
      .map((subject) => subject.trim())
      .filter(Boolean),
  )
}

async function provisionBootstrapAdmin(
  tenantId: string,
  januaSub: string,
  user: { email?: string | null; name?: string | null },
): Promise<string | null> {
  if (!user.email) return null
  const service = new UsersService(
    createServiceContext(
      getDb(tenantId),
      getCacheManager(),
      { ...EMPTY_AUTH, userId: 'system:bootstrap', tenantId },
      tenantId,
    ),
  )
  try {
    const created = await service.create({
      email: user.email,
      name: user.name ?? undefined,
      role: 'admin',
      externalJanuaId: januaSub,
    })
    staffGateLogger.warn(
      { tenantId, januaSub, crmUserId: created.id },
      'bootstrap: provisioned a CRM admin for a listed Janua subject',
    )
    return created.id
  } catch (err) {
    // Lost a race, or the subject or email is already taken: resolve again.
    staffGateLogger.warn(
      { tenantId, januaSub, err },
      'bootstrap: could not provision; resolving again',
    )
    crmUserResolver.invalidate(tenantId, januaSub)
    return resolveCrmUserId(tenantId, januaSub)
  }
}

export const EMPTY_AUTH: AuthContext = {
  userId: '',
  tenantId: DEFAULT_TENANT_ID,
  roles: [],
  scopes: [],
  accessToken: '',
}

/**
 * The CRM `users.id` linked to a Janua subject (`users.external_janua_id`), or
 * null. Cached per tenant + subject for a short TTL (see CrmUserResolver).
 * A database failure propagates: the request fails visibly rather than running
 * as an unlinked user.
 */
async function resolveCrmUserId(tenantId: string, januaSub: string): Promise<string | null> {
  return crmUserResolver.resolve(getDb(tenantId), tenantId, januaSub)
}

/** The CRM user linked to a Janua subject, provisioning a listed bootstrap admin. */
async function linkedCrmUserId(
  tenantId: string,
  januaSub: string,
  user: { email?: string | null; name?: string | null },
): Promise<string | null> {
  if (!januaSub) return null
  const crmUserId = await resolveCrmUserId(tenantId, januaSub)
  if (crmUserId || !bootstrapAdminSubjects().has(januaSub)) return crmUserId
  return provisionBootstrapAdmin(tenantId, januaSub, user)
}

export async function resolveAuthContext(
  headers: Headers,
  options?: { demoSessionId?: string | null },
): Promise<AuthContext> {
  const tenantId = resolveTenantIdFromHeaders(headers)
  const demoSessionId = options?.demoSessionId ?? null

  const session = await auth()
  if (session?.user) {
    const januaSub = session.user.id ?? ''
    const crmUserId = await linkedCrmUserId(tenantId, januaSub, session.user)
    if (!crmUserId && !allowUnlinkedSignIn()) {
      staffGateLogger.warn(
        { tenantId, januaSub },
        'signed-in Janua account is not linked to a CRM user; treating the request as signed out',
      )
      return { ...EMPTY_AUTH, tenantId }
    }
    return {
      userId: januaSub,
      tenantId,
      roles: session.user.roles ?? [],
      scopes: session.user.scopes ?? [],
      accessToken: session.accessToken ?? '',
      ...(januaSub ? { januaSub, crmUserId } : {}),
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

function logServiceAuth(req: Request, authCtx: AuthContext, surface: 'trpc' | 'graphql') {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
  serviceAuthLogger.info(
    {
      event: 'service_auth',
      surface,
      userId: authCtx.userId,
      tenantId: authCtx.tenantId,
      path: new URL(req.url).pathname,
      ip,
    },
    'Service token authenticated',
  )
}

/** Shared auth + tenant resolution for tRPC and GraphQL route handlers. */
export async function createAppContextFromRequest(
  req: Request,
  surface: 'trpc' | 'graphql',
): Promise<ReturnType<typeof createAppContext>> {
  const authHeader = req.headers.get('authorization') ?? ''
  if (FEDERATION_TOKEN && authHeader === `Bearer ${FEDERATION_TOKEN}`) {
    const tenantId = resolveTenantIdFromHeaders(req.headers)
    const authCtx = createServiceAuth(tenantId)
    logServiceAuth(req, authCtx, surface)
    return createAppContext(authCtx)
  }

  const demoSessionId = getDemoSessionIdFromCookieHeader(req.headers.get('cookie') ?? '')
  const authCtx = await resolveAuthContext(req.headers, { demoSessionId })
  return createAppContext(authCtx)
}

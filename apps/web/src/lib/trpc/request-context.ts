import crypto from 'node:crypto'
import { auth } from '@/lib/auth'
import {
  type StaffBootstrapMatch,
  matchStaffBootstrap,
  staffBootstrapEntries,
} from '@/lib/auth/staff-bootstrap'
import { clientAddress } from '@/lib/client-address'
import { createDemoAuth, getDemoSessionIdFromCookieHeader } from '@/lib/demo'
import { getCacheManager, getFederationClients, getHealthChecker } from '@/lib/federation/clients'
import { resolveTenantIdFromHeaders } from '@/lib/http/tenant-context'
import { bearerJwt, machineAuthConfig, verifyMachineToken } from '@/lib/trpc/machine-auth'
import { createCallerFactory } from '@phynd/api'
import { appRouter } from '@phynd/api/router'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { resolveFederationServiceUserId } from '@phynd/config/service-auth'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { UsersService } from '@phynd/services'
import { createServiceContext } from '@phynd/services/context'
import { type LinkedCrmUser, crmUserResolver } from '@phynd/services/identity'
import { type AuthContext, isStaffRole } from '@phynd/types/auth'

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

/**
 * Scopes of the LEGACY static bearer (`FEDERATION_API_TOKEN`, principal
 * `service:selva`). Never granted to a Janua machine token: those get only what
 * `MACHINE_SCOPE_GRANTS` (`machine-auth.ts`) maps their scope to.
 */
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
 * deployment, as a break-glass while a staff account is being linked; such an
 * unlinked session has no roles, so every role-gated action stays closed.
 */
export function allowUnlinkedSignIn(): boolean {
  return process.env.PHYND_ALLOW_UNLINKED_SIGNIN === 'true'
}

/**
 * First-sign-in provisioning of a bootstrap-listed staff account (see
 * lib/auth/staff-bootstrap.ts): creates its CRM user with the listed role, or
 * links the CRM user that already has its verified email. Logs the subject and
 * role, never the email.
 */
async function provisionBootstrapStaff(
  tenantId: string,
  januaSub: string,
  user: StaffSessionUser,
  match: StaffBootstrapMatch,
): Promise<LinkedCrmUser | null> {
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
    const linked = await service.bootstrapStaff({
      januaSub,
      email: user.email,
      name: user.name,
      role: match.role,
      linkByEmail: match.by === 'email',
    })
    if (!linked) return null
    staffGateLogger.warn(
      { tenantId, januaSub, role: linked.role, matchedBy: match.by, crmUserId: linked.id },
      'bootstrap: provisioned a CRM user for a listed staff account',
    )
    crmUserResolver.invalidate(tenantId, januaSub)
    return { id: linked.id, role: linked.role }
  } catch (err) {
    // Lost a race, or the subject is already taken: resolve again. Only the
    // error's name is logged: a query error can carry the email as a parameter.
    staffGateLogger.warn(
      { tenantId, januaSub, role: match.role, error: (err as Error)?.name },
      'bootstrap: could not provision; resolving again',
    )
    crmUserResolver.invalidate(tenantId, januaSub)
    return crmUserResolver.resolveUser(getDb(tenantId), tenantId, januaSub)
  }
}

export const EMPTY_AUTH: AuthContext = {
  userId: '',
  tenantId: DEFAULT_TENANT_ID,
  roles: [],
  scopes: [],
  accessToken: '',
}

interface StaffSessionUser {
  email?: string | null
  name?: string | null
  januaEmailVerified?: boolean
}

/**
 * The CRM user (id and role) linked to a Janua subject through
 * `users.external_janua_id`, provisioning a bootstrap-listed account; or null.
 * Cached per tenant + subject for a short TTL (see CrmUserResolver). A
 * database failure propagates: the request fails visibly rather than running
 * as an unlinked user.
 */
async function linkedCrmUser(
  tenantId: string,
  januaSub: string,
  user: StaffSessionUser,
): Promise<LinkedCrmUser | null> {
  if (!januaSub) return null
  const linked = await crmUserResolver.resolveUser(getDb(tenantId), tenantId, januaSub)
  if (linked) return linked
  const match = matchStaffBootstrap(staffBootstrapEntries(), {
    subject: januaSub,
    email: user.email,
    emailVerified: user.januaEmailVerified === true,
  })
  return match ? provisionBootstrapStaff(tenantId, januaSub, user, match) : null
}

/**
 * A staff session's roles: exactly the linked CRM user's role. The roles in
 * Janua's tokens are not used. No CRM user, or a role outside STAFF_ROLES,
 * means no roles.
 */
export function staffRolesOf(crmUser: LinkedCrmUser | null): string[] {
  if (!crmUser) return []
  if (isStaffRole(crmUser.role)) return [crmUser.role]
  staffGateLogger.warn(
    { crmUserId: crmUser.id },
    'linked CRM user has a role outside STAFF_ROLES; no roles granted',
  )
  return []
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
    const crmUser = await linkedCrmUser(tenantId, januaSub, session.user)
    if (!crmUser && !allowUnlinkedSignIn()) {
      staffGateLogger.warn(
        { tenantId, januaSub },
        'signed-in Janua account is not linked to a CRM user; treating the request as signed out',
      )
      return { ...EMPTY_AUTH, tenantId }
    }
    return {
      userId: januaSub,
      tenantId,
      // The linked CRM user's role, never the token's roles. An unlinked
      // break-glass session gets no roles: pages, but no role-gated action.
      roles: staffRolesOf(crmUser),
      scopes: session.user.scopes ?? [],
      accessToken: session.accessToken ?? '',
      ...(januaSub ? { januaSub, crmUserId: crmUser?.id ?? null } : {}),
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
  const ip = clientAddress(req.headers)
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

/**
 * A Janua machine token, verified, as a least-privilege service context; or,
 * when it is refused, a signed-out context. A refused token never falls back to
 * the static bearer or to a session cookie.
 */
async function resolveMachineAuth(
  req: Request,
  token: string,
  config: NonNullable<ReturnType<typeof machineAuthConfig>>,
  surface: 'trpc' | 'graphql',
): Promise<AuthContext> {
  const path = new URL(req.url).pathname
  const signedOut = { ...EMPTY_AUTH, tenantId: resolveTenantIdFromHeaders(req.headers) }
  // GraphQL resolvers check only that a principal exists, not its scopes, so a
  // machine token is honoured on the tRPC surface only.
  if (surface !== 'trpc') {
    serviceAuthLogger.warn(
      { event: 'machine_auth_rejected', reason: 'surface_not_allowed', surface, path },
      'Machine token refused',
    )
    return signedOut
  }
  const result = await verifyMachineToken(token, config)
  if (!result.ok) {
    serviceAuthLogger.warn(
      {
        event: 'machine_auth_rejected',
        reason: result.reason,
        detail: result.detail,
        surface,
        path,
      },
      'Machine token refused',
    )
    return signedOut
  }
  serviceAuthLogger.info(
    {
      event: 'machine_auth',
      surface,
      clientId: result.clientId,
      userId: result.auth.userId,
      tokenScopes: result.tokenScopes,
      grantedScopes: result.auth.scopes,
      tenantId: result.auth.tenantId,
      path,
    },
    'Machine token authenticated',
  )
  return result.auth
}

/**
 * Shared auth + tenant resolution for tRPC and GraphQL route handlers.
 *
 * Order: (1) the legacy static bearer, on an exact match only; (2) a
 * JWT-shaped bearer goes to the Janua machine-token path when it is configured,
 * and is never retried as anything else; (3) the session cookie / demo session.
 * With machine tokens unconfigured, step 2 is skipped: behaviour is unchanged.
 */
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

  const machineToken = bearerJwt(authHeader)
  const machineConfig = machineToken ? machineAuthConfig() : null
  if (machineToken && machineConfig) {
    return createAppContext(await resolveMachineAuth(req, machineToken, machineConfig, surface))
  }

  const demoSessionId = getDemoSessionIdFromCookieHeader(req.headers.get('cookie') ?? '')
  const authCtx = await resolveAuthContext(req.headers, { demoSessionId })
  return createAppContext(authCtx)
}

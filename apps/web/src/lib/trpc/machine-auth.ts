/**
 * Janua `client_credentials` machine tokens: one edge, one client, one scope.
 *
 * A machine caller (another MADFAM service) presents a Janua-issued RS256
 * access token. It is accepted only when ALL of these hold:
 *
 * - the signature verifies against Janua's JWKS (`<issuer>/.well-known/jwks.json`),
 *   `iss` is `AUTH_JANUA_ISSUER`, and `aud` includes `PHYND_CRM_MACHINE_AUDIENCE`
 *   (default `phynd-crm`);
 * - it is a machine token: `token_use` `client_credentials`, `actor_type`
 *   `service_account`, `type` `access`, `sub` `service-account:<client_id>`,
 *   and a lifetime of at most one hour;
 * - its `org_id` is the Janua organization this deployment trusts
 *   (`PHYND_CRM_MACHINE_JANUA_ORG_ID`);
 * - its `scope` holds at least one scope in MACHINE_SCOPE_GRANTS.
 *
 * What it grants:
 *
 * - scopes: only what MACHINE_SCOPE_GRANTS maps the token's scopes to. Never
 *   the static bearer's SERVICE_AUTH_SCOPES, never `*`. Unknown scopes grant
 *   nothing.
 * - principal: `service:<client_id>`, so every call is attributable to the
 *   Janua client that made it (never `service:selva`).
 * - tenant: `PHYND_CRM_MACHINE_TENANT_ID`, bound to the token's signed `org_id`.
 *   The request's Host or any other caller-supplied header is ignored.
 *
 * Off by default: while AUTH_JANUA_ISSUER, PHYND_CRM_MACHINE_TENANT_ID or
 * PHYND_CRM_MACHINE_JANUA_ORG_ID is unset, `machineAuthConfig()` is null and
 * request handling is exactly what it was before this module existed.
 */
import { remoteJwksFor } from '@/lib/portal/jwks'
import type { AuthContext } from '@phynd/types/auth'
import { errors as joseErrors, jwtVerify } from 'jose'

export const DEFAULT_MACHINE_AUDIENCE = 'phynd-crm'

/** Janua mints service tokens for 15 minutes; anything over an hour is refused. */
export const MACHINE_TOKEN_MAX_LIFETIME_SECONDS = 3600

/** Tolerated clock difference between Janua and this service. */
const CLOCK_SKEW_SECONDS = 60

/**
 * Janua scope → phynd internal scopes (`<router>:read|write`, checked per
 * tRPC path by `enforceServiceScopes` in `@phynd/api`).
 *
 * Fixed and explicit. Each entry is a reviewed machine edge; a new one needs
 * its Janua reservation (audience + scope) deployed before any client carries
 * it. Entries are read-only today; a write grant must be its own explicit,
 * reviewed entry, never folded into an existing read scope.
 */
export const MACHINE_SCOPE_GRANTS: ReadonlyMap<string, readonly string[]> = new Map([
  // Client-facing project portal (nauta): engagement + contact reads only.
  ['phynd-crm-engagements:read', Object.freeze(['engagements:read', 'contacts:read'])],
])

export interface MachineAuthConfig {
  issuer: string
  audience: string
  tenantId: string
  januaOrgId: string
}

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

/** The machine-token configuration, or null (machine tokens off). */
export function machineAuthConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MachineAuthConfig | null {
  const issuer = env.AUTH_JANUA_ISSUER?.trim().replace(/\/+$/, '') ?? ''
  const audience = env.PHYND_CRM_MACHINE_AUDIENCE?.trim() || DEFAULT_MACHINE_AUDIENCE
  const tenantId = env.PHYND_CRM_MACHINE_TENANT_ID?.trim() ?? ''
  const januaOrgId = env.PHYND_CRM_MACHINE_JANUA_ORG_ID?.trim() ?? ''
  if (!issuer || !tenantId || !januaOrgId) return null
  // Demo tenants are per-visitor sandboxes, never a machine edge's tenant.
  if (!TENANT_ID_PATTERN.test(tenantId) || tenantId.startsWith('demo-')) return null
  return { issuer, audience, tenantId, januaOrgId }
}

/** The token of a `Bearer <jwt>` header, or null when it is not JWT-shaped. */
export function bearerJwt(authorizationHeader: string): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim())
  const token = match?.[1]
  return token && JWT_SHAPE.test(token) ? token : null
}

/** Union of the internal scopes `tokenScopes` map to; unknown scopes add nothing. */
export function grantedScopes(tokenScopes: readonly string[]): string[] {
  const granted = new Set<string>()
  for (const scope of tokenScopes) {
    for (const internal of MACHINE_SCOPE_GRANTS.get(scope) ?? []) granted.add(internal)
  }
  return [...granted].sort()
}

export type MachineAuthRejection =
  | 'invalid_token'
  | 'not_client_credentials'
  | 'bad_subject'
  | 'bad_lifetime'
  | 'org_mismatch'
  | 'no_scope'
  | 'no_mapped_scope'

export type MachineAuthResult =
  | { ok: true; auth: AuthContext; clientId: string; tokenScopes: string[] }
  | { ok: false; reason: MachineAuthRejection; detail?: string }

function reject(reason: MachineAuthRejection, detail?: string): MachineAuthResult {
  return detail ? { ok: false, reason, detail } : { ok: false, reason }
}

type Claims = Record<string, unknown>

/** Signature, issuer, audience and expiry (jose), or the refusal. */
async function verifySignature(
  token: string,
  config: MachineAuthConfig,
  nowSeconds: number,
): Promise<Claims | MachineAuthResult> {
  try {
    const verified = await jwtVerify(
      token,
      remoteJwksFor(new URL('/.well-known/jwks.json', config.issuer)),
      {
        algorithms: ['RS256'],
        issuer: config.issuer,
        audience: config.audience,
        requiredClaims: ['exp', 'iat', 'sub'],
        clockTolerance: CLOCK_SKEW_SECONDS,
        currentDate: new Date(nowSeconds * 1000),
      },
    )
    return verified.payload as Claims
  } catch (err) {
    // A JOSE code (expired, claim mismatch, no matching key) is safe to log;
    // anything else (JWKS unreachable) is reported by name only.
    const detail =
      err instanceof joseErrors.JOSEError ? err.code : err instanceof Error ? err.name : 'unknown'
    return reject('invalid_token', detail)
  }
}

/** The client id of a Janua service-account token, or the refusal. */
function machineIdentity(
  payload: Claims,
  nowSeconds: number,
): { clientId: string } | { refusal: MachineAuthRejection } {
  if (
    payload.token_use !== 'client_credentials' ||
    payload.actor_type !== 'service_account' ||
    payload.type !== 'access'
  ) {
    return { refusal: 'not_client_credentials' }
  }
  const clientId = payload.client_id
  if (
    typeof clientId !== 'string' ||
    !CLIENT_ID_PATTERN.test(clientId) ||
    payload.sub !== `service-account:${clientId}`
  ) {
    return { refusal: 'bad_subject' }
  }
  const issuedAt = payload.iat as number
  const lifetime = (payload.exp as number) - issuedAt
  if (
    !(lifetime > 0 && lifetime <= MACHINE_TOKEN_MAX_LIFETIME_SECONDS) ||
    issuedAt > nowSeconds + CLOCK_SKEW_SECONDS
  ) {
    return { refusal: 'bad_lifetime' }
  }
  return { clientId }
}

function isRefusal(value: Claims | MachineAuthResult): value is MachineAuthResult {
  return 'ok' in value && value.ok === false
}

/** Verifies a Janua machine token and builds its least-privilege auth context. */
export async function verifyMachineToken(
  token: string,
  config: MachineAuthConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<MachineAuthResult> {
  const payload = await verifySignature(token, config, nowSeconds)
  if (isRefusal(payload)) return payload

  const identity = machineIdentity(payload, nowSeconds)
  if ('refusal' in identity) return reject(identity.refusal)
  const { clientId } = identity

  if (payload.org_id !== config.januaOrgId) return reject('org_mismatch')

  const scopeClaim = payload.scope
  const tokenScopes = typeof scopeClaim === 'string' ? scopeClaim.split(/\s+/).filter(Boolean) : []
  if (tokenScopes.length === 0) return reject('no_scope')

  const scopes = grantedScopes(tokenScopes)
  if (scopes.length === 0) return reject('no_mapped_scope')

  return {
    ok: true,
    clientId,
    tokenScopes,
    auth: {
      userId: `service:${clientId}`,
      tenantId: config.tenantId,
      roles: ['service'],
      scopes,
      // The caller's token is never forwarded downstream.
      accessToken: '',
    },
  }
}

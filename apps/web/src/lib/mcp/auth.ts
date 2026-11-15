/**
 * Who may call the native MCP.
 *
 * Authentication is the app's existing Janua machine-token verifier
 * (`verifyMachineIdentity` in `lib/trpc/machine-auth.ts`: RS256 against Janua's
 * JWKS, issuer, audience, `client_credentials` claims, subject, lifetime).
 * Authorization is the MCP's own and independent of the tRPC machine path:
 *
 *   1. the token's `org_id` is the organization this deployment trusts;
 *   2. its scope holds `phynd-crm-pipeline:read`, matched exactly (a token
 *      scoped for tRPC, a prefix or a longer name opens nothing);
 *   3. its client id is bound to that organization in
 *      `PHYND_CRM_MCP_READ_CLIENTS`.
 *
 * The tenant is the deployment's machine tenant (`PHYND_CRM_MACHINE_TENANT_ID`),
 * bound to the signed `org_id`. Nothing the caller sends (Host, headers,
 * arguments) can choose another.
 *
 * Masking is decided here too: every caller is masked unless its
 * `client@org` is in `PHYND_CRM_MCP_UNMASKED_CLIENTS` and that whole list is
 * well formed and a subset of the readers list (`unmaskedClients`).
 *
 * Janua's keys that cannot be fetched (network error, timeout, a non-200 or
 * unreadable key set) are an outage, not a bad token: 503, never 401.
 */
import {
  type MachineAuthConfig,
  bearerJwt,
  machineAuthConfig,
  verifyMachineIdentity,
} from '@/lib/trpc/machine-auth'
import { createLogger } from '@phynd/logging'
import type { AuthContext } from '@phynd/types/auth'

import {
  MCP_ENABLED_ENV,
  MCP_INTERNAL_SCOPES,
  MCP_READ_CLIENTS_ENV,
  MCP_READ_SCOPE,
  MCP_UNMASKED_CLIENTS_ENV,
  mcpEnabled,
  parseReadClients,
} from './settings'

type Env = Readonly<Record<string, string | undefined>>

const logger = createLogger('web:mcp')

export interface McpCaller {
  ok: true
  clientId: string
  /** Least-privilege principal `service:<client_id>` in the deployment's machine tenant. */
  auth: AuthContext
  /** Personal fields are masked for this caller (the default). */
  masked: boolean
}

export type McpRefusalError =
  | 'invalid_token'
  | 'foreign_organization'
  | 'insufficient_scope'
  | 'client_not_allowed'
  | 'verifier_unavailable'

export interface McpRefusal {
  ok: false
  status: 401 | 403 | 503
  error: McpRefusalError
  /** Safe to log: a reason code, never the token. */
  reason: string
  /** Known once the token itself verified. */
  clientId?: string
}

export type McpSwitch =
  | { state: 'off' }
  /** Switched on, but machine tokens are not configured: still answers 404. */
  | { state: 'unconfigured' }
  | { state: 'on'; config: MachineAuthConfig }

/** Read per request, so turning the switch off needs no code change. */
export function mcpSwitch(env: Env = process.env): McpSwitch {
  if (!mcpEnabled(env[MCP_ENABLED_ENV])) return { state: 'off' }
  const config = machineAuthConfig(env)
  return config ? { state: 'on', config } : { state: 'unconfigured' }
}

function refuse(
  status: 401 | 403 | 503,
  error: McpRefusalError,
  reason: string,
  clientId?: string,
): McpRefusal {
  return clientId
    ? { ok: false, status, error, reason, clientId }
    : { ok: false, status, error, reason }
}

export async function resolveMcpCaller(
  authorizationHeader: string | null,
  config: MachineAuthConfig,
  env: Env = process.env,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<McpCaller | McpRefusal> {
  const token = authorizationHeader ? bearerJwt(authorizationHeader) : null
  if (!token) return refuse(401, 'invalid_token', 'missing_or_malformed_bearer')

  const verified = await verifyMachineIdentity(token, config, nowSeconds)
  if (!verified.ok && verified.reason === 'keys_unavailable') {
    return refuse(503, 'verifier_unavailable', `keys_unavailable:${verified.detail ?? 'unknown'}`)
  }
  if (!verified.ok) {
    return refuse(
      401,
      'invalid_token',
      verified.detail ? `${verified.reason}:${verified.detail}` : verified.reason,
    )
  }
  const { clientId, orgId, tokenScopes } = verified.identity

  if (orgId !== config.januaOrgId) {
    return refuse(403, 'foreign_organization', 'org_mismatch', clientId)
  }
  if (!tokenScopes.includes(MCP_READ_SCOPE)) {
    return refuse(403, 'insufficient_scope', 'scope_missing', clientId)
  }
  const readers = parseReadClients(env[MCP_READ_CLIENTS_ENV])
  if (readers === null) {
    // One bad entry disables every reader: never guess which were meant.
    return refuse(403, 'client_not_allowed', 'readers_malformed', clientId)
  }
  if (readers.get(clientId) !== orgId) {
    return refuse(403, 'client_not_allowed', 'client_not_in_readers', clientId)
  }

  return {
    ok: true,
    clientId,
    masked: !unmaskedClients(env, readers).has(clientId),
    auth: {
      userId: `service:${clientId}`,
      tenantId: config.tenantId,
      roles: ['service'],
      scopes: [...MCP_INTERNAL_SCOPES],
      // The caller's token is never forwarded downstream.
      accessToken: '',
    },
  }
}

/** The last malformed unmasked-clients value warned about: one warning per value, not per request. */
let warnedUnmasked: string | null = null

/**
 * The clients the owner lets read personal fields unmasked. FAIL SAFE: unset,
 * blank, malformed, duplicated, or any entry that is not also a reader (same
 * client, same organization) → nobody.
 */
export function unmaskedClients(env: Env, readers: ReadonlyMap<string, string>): Set<string> {
  const raw = env[MCP_UNMASKED_CLIENTS_ENV]
  const listed = parseReadClients(raw)
  const valid =
    listed !== null && [...listed].every(([clientId, orgId]) => readers.get(clientId) === orgId)
  if (!valid) {
    if (warnedUnmasked !== raw) {
      warnedUnmasked = raw ?? null
      logger.warn(
        { event: 'mcp_unmasked_clients_ignored' },
        `${MCP_UNMASKED_CLIENTS_ENV} is malformed or names a client that is not a reader; every MCP client is masked`,
      )
    }
    return new Set()
  }
  return new Set(listed.keys())
}

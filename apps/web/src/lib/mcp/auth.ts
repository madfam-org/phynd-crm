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
 */
import {
  type MachineAuthConfig,
  bearerJwt,
  machineAuthConfig,
  verifyMachineIdentity,
} from '@/lib/trpc/machine-auth'
import type { AuthContext } from '@phynd/types/auth'

import {
  MCP_ENABLED_ENV,
  MCP_INTERNAL_SCOPES,
  MCP_READ_CLIENTS_ENV,
  MCP_READ_SCOPE,
  mcpEnabled,
  parseReadClients,
} from './settings'

type Env = Readonly<Record<string, string | undefined>>

export interface McpCaller {
  ok: true
  clientId: string
  /** Least-privilege principal `service:<client_id>` in the deployment's machine tenant. */
  auth: AuthContext
}

export type McpRefusalError =
  | 'invalid_token'
  | 'foreign_organization'
  | 'insufficient_scope'
  | 'client_not_allowed'

export interface McpRefusal {
  ok: false
  status: 401 | 403
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
  status: 401 | 403,
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

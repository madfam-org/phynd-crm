/**
 * The process's MCP server, wired to the app's own parts: the Janua machine
 * verifier, the Redis rate limiter every API route uses (fail closed, in
 * namespaces of its own), the
 * tenant database and the structured logger.
 *
 * `mcpServerFor()` is null while the MCP is off, and the route then answers
 * 404 as if it did not exist. "Off" is: `PHYND_CRM_MCP_ENABLED` not exactly
 * `true`, OR machine tokens not configured (`docs/MACHINE_AUTH.md`). The second
 * case is logged, so a switch flipped without its prerequisites is visible.
 */
import { getCacheManager } from '@/lib/federation/clients'
import { type RateLimitResult, checkApiRateLimit } from '@/lib/rate-limiter'
import type { MachineAuthConfig } from '@/lib/trpc/machine-auth'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { createServiceContext } from '@phynd/services/context'

import { mcpSwitch, resolveMcpCaller } from './auth'
import {
  type McpAuditRecord,
  type McpRateDecision,
  type McpServer,
  createMcpServer,
} from './server'
import {
  MCP_CLIENT_REQUESTS_PER_MINUTE,
  MCP_ENABLED_ENV,
  MCP_IP_REQUESTS_PER_MINUTE,
} from './settings'
import { MCP_TOOLS } from './tools'

const logger = createLogger('web:mcp')

/** Refusals and failures at `warn`, everything else at `info`. */
function writeAudit(record: McpAuditRecord): void {
  if (record.httpStatus >= 400 || record.outcome === 'internal_error') {
    logger.warn(record, 'MCP call refused')
  } else {
    logger.info(record, 'MCP call')
  }
}

function rateDecision(result: RateLimitResult): McpRateDecision {
  if (result.allowed) return { allowed: true }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
    unavailable: result.unavailable,
  }
}

function serverFor(config: MachineAuthConfig): McpServer {
  return createMcpServer({
    verify: (authorization) => resolveMcpCaller(authorization, config),
    // Each bucket has a namespace of its own: no address-keyed limiter of
    // another route (keyed by whatever `X-Forwarded-For` says) can reach it.
    allowIp: async (ip) =>
      rateDecision(
        await checkApiRateLimit(ip, {
          maxRequests: MCP_IP_REQUESTS_PER_MINUTE,
          namespace: 'mcp-address',
        }),
      ),
    allowClient: async (clientId) =>
      rateDecision(
        await checkApiRateLimit(clientId, {
          maxRequests: MCP_CLIENT_REQUESTS_PER_MINUTE,
          namespace: 'mcp-client',
        }),
      ),
    // The tenant is the verified caller's (the deployment's machine tenant):
    // the database is never chosen from the request.
    contextFor: (auth) =>
      createServiceContext(getDb(auth.tenantId), getCacheManager(), auth, auth.tenantId),
    tools: MCP_TOOLS,
    audit: writeAudit,
    now: () => performance.now(),
  })
}

export function mcpServerFor(
  env: Readonly<Record<string, string | undefined>> = process.env,
): McpServer | null {
  const state = mcpSwitch(env)
  if (state.state === 'off') return null
  if (state.state === 'unconfigured') {
    logger.warn(
      { event: 'mcp_not_configured' },
      `${MCP_ENABLED_ENV} is true but Janua machine tokens are not configured; /mcp stays 404`,
    )
    return null
  }
  return serverFor(state.config)
}

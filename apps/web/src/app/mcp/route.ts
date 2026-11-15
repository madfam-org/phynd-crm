import { mcpServerFor } from '@/lib/mcp/default-server'
import { mcpMethodNotAllowed, mcpNotFound } from '@/lib/mcp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `POST /mcp`: PhyndCRM's native MCP, for agents and agent fleets. Read-only.
 *
 * OFF BY DEFAULT. Unless `PHYND_CRM_MCP_ENABLED` is exactly `true` (and Janua
 * machine tokens are configured), every method answers 404 before any header
 * is read: the route does not exist. The owner turns it on; agents never do.
 * On, only POST speaks JSON-RPC; every other method is 405.
 *
 * The middleware lets `/mcp` through without a staff session: the Janua
 * machine token (scope `phynd-crm-pipeline:read`, client on the readers list)
 * is the only gate, and the tenant is the deployment's machine tenant, never
 * the Host. Protocol, gates, tools and audit: `lib/mcp/`; operations:
 * `docs/NATIVE_MCP.md`.
 */

export async function POST(request: Request): Promise<Response> {
  const server = mcpServerFor()
  return server === null ? mcpNotFound() : server.handle(request)
}

function notPost(): Response {
  return mcpServerFor() === null ? mcpNotFound() : mcpMethodNotAllowed()
}

export async function GET(): Promise<Response> {
  return notPost()
}

export async function DELETE(): Promise<Response> {
  return notPost()
}

export async function PUT(): Promise<Response> {
  return notPost()
}

export async function PATCH(): Promise<Response> {
  return notPost()
}

/** Without this, Next would answer OPTIONS itself (204) even while the MCP is off. */
export async function OPTIONS(): Promise<Response> {
  return notPost()
}

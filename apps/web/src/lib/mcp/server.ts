/**
 * PhyndCRM's native MCP endpoint: `POST /mcp`, Streamable HTTP, JSON-RPC 2.0,
 * STATELESS: no `Mcp-Session-Id`, no server-sent streams, one
 * `application/json` body per response. Hand-written on the model of the
 * ecosystem's other native servers (Nauta, Dhanam): the surface is four
 * methods, so no MCP SDK dependency was added.
 *
 * GATES, IN ORDER (each one answers before the next is looked at; the switch
 * itself is the route's, see `app/mcp/route.ts`):
 *   1. the source address over its rate → 429 (before any token is verified);
 *      the address is the shared `clientAddress()` (`lib/client-address.ts`):
 *      never a caller-chosen first `X-Forwarded-For` entry, and anything that
 *      is not an IP address shares `UNKNOWN_CLIENT_ADDRESS`;
 *   2. a browser `Origin` header → 403 `origin_not_allowed` (machine clients
 *      only; DNS-rebinding protection, as the transport requires);
 *   3. the Janua machine token (`lib/mcp/auth.ts`) → 401 with
 *      `WWW-Authenticate: Bearer realm="phynd-crm-mcp"`; a valid machine token
 *      without the scope, from another organization or not on the readers
 *      list → 403; Janua's keys unreachable → 503 with `Retry-After` (an
 *      outage must not read as a wave of bad tokens);
 *   4. the client over its rate → 429 with `Retry-After` = the time left in
 *      its window.
 *   A rate limiter that cannot be read refuses (fail closed) with 503 and
 *   `Retry-After`, not 429: it is not the caller's fault.
 *   5. an unsupported `MCP-Protocol-Version` → 400; not `application/json` →
 *      415; over 64 KiB → 413; a batch → 400;
 *   6. the JSON-RPC message: `initialize`, `ping`, `tools/list`,
 *      `tools/call`; notifications → 202.
 *
 * AUDIT: one record per request (`McpAuditRecord`). For `tools/call` it
 * carries the client, the tenant, the tool, the outcome, how many rows left
 * and an argument summary each tool builds from identifiers and enumerations
 * only. Search text and every other free-text argument is never recorded, and
 * no argument digest is kept either (a hash of a short search term can be
 * reversed by guessing).
 */
import { clientAddress } from '@/lib/client-address'
import type { ServiceContext } from '@phynd/services/context'
import type { AuthContext } from '@phynd/types/auth'

import type { McpCaller, McpRefusal } from './auth'
import {
  MCP_INSTRUCTIONS,
  MCP_LATEST_PROTOCOL_VERSION,
  MCP_MAX_BODY_BYTES,
  MCP_PROTOCOL_VERSIONS,
  MCP_READ_SCOPE,
  MCP_SERVER_INFO,
  MCP_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from './settings'
import { McpArgumentError, type McpTool, READ_ONLY_ANNOTATIONS } from './tool'

export const MCP_REALM = 'realm="phynd-crm-mcp"'

const CODE = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  rateLimited: -32000,
} as const

/** The only method names an audit record may carry: anything else is caller-chosen text. */
const KNOWN_METHODS: ReadonlySet<string> = new Set([
  'initialize',
  'ping',
  'tools/list',
  'tools/call',
  'notifications/initialized',
  'notifications/cancelled',
])

/** What an audit record says the method was: a known name, `other`, or nothing. */
function recordedMethod(method: string): string {
  if (method === '') return ''
  return KNOWN_METHODS.has(method) ? method : 'other'
}

/** A notification, or a response to a server request: accepted, nothing to answer. */
function isAnswerless(message: Readonly<Record<string, unknown>>, method: string): boolean {
  return method !== '' || 'result' in message || 'error' in message
}

export interface McpAuditRecord {
  event: 'mcp_call'
  clientId: string | null
  tenantId: string | null
  rpcMethod: string
  tool: string | null
  outcome: string
  httpStatus: number
  latencyMs: number
  /** Rows that left in a successful `tools/call`; null otherwise. */
  resultCount: number | null
  /** Identifiers and enumerations only (see the file header); null when no tool ran. */
  args: Readonly<Record<string, string | number | boolean>> | null
  /** A reason code or an error class name; never a message, a token or a row. */
  detail: string | null
  /** Whether personal fields were masked for this caller; null before a caller is known. */
  masked: boolean | null
}

/** A rate limiter's answer: allowed, or refused with when to retry. */
export type McpRateDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false
      readonly retryAfterSeconds: number
      /** The limiter backend failed (refused, fail closed): 503, not 429. */
      readonly unavailable: boolean
    }

export interface McpServerDeps {
  readonly verify: (authorization: string | null) => Promise<McpCaller | McpRefusal>
  /** The source address's rate (`clientAddress()`), before any token is read. */
  readonly allowIp: (ip: string) => Promise<McpRateDecision>
  /** The verified client's rate. */
  readonly allowClient: (clientId: string) => Promise<McpRateDecision>
  /** The service context every tool of this call runs in. */
  readonly contextFor: (auth: AuthContext) => ServiceContext
  readonly tools: readonly McpTool[]
  readonly audit: (record: McpAuditRecord) => void
  /** Milliseconds, monotonic enough for latency. */
  readonly now: () => number
}

type Json = Record<string, unknown>
type RpcId = string | number
type Audit = Omit<McpAuditRecord, 'httpStatus' | 'latencyMs'> & { start: number }

const BASE_HEADERS = { 'cache-control': 'no-store' } as const

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, 'content-type': 'application/json', ...headers },
  })
}

function rpcResult(id: RpcId, result: unknown): Response {
  return json(200, { jsonrpc: '2.0', id, result })
}

function rpcError(
  status: number,
  id: RpcId | null,
  code: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return json(status, { jsonrpc: '2.0', id, error: { code, message } }, headers)
}

/** A refusal the caller can act on, as a tool result (`isError`), not a protocol error. */
function toolError(id: RpcId, text: string): Response {
  return rpcResult(id, { content: [{ type: 'text', text }], isError: true })
}

/** The `404` a switched-off MCP answers on every method: the route does not exist. */
export function mcpNotFound(): Response {
  return json(404, { error: 'not_found' })
}

/** GET, DELETE and the rest: the server opens no streams and keeps no sessions. */
export function mcpMethodNotAllowed(): Response {
  return json(
    405,
    { error: 'method_not_allowed', message: 'POST JSON-RPC messages to /mcp' },
    { allow: 'POST' },
  )
}

function isPlainObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** MCP request ids are strings or integers, never null. */
function isValidId(value: unknown): value is RpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value))
}

function isSupportedVersion(value: unknown): value is (typeof MCP_PROTOCOL_VERSIONS)[number] {
  return typeof value === 'string' && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(value)
}

/** Reads at most `limit + 1` bytes, so an oversized body is refused without buffering it all. */
async function readCapped(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > limit) return null
  if (request.body === null) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function createMcpServer(deps: McpServerDeps) {
  const byName = new Map(deps.tools.map((tool) => [tool.name, tool]))
  if (byName.size !== deps.tools.length) throw new Error('mcp: duplicate tool names')

  function toolList() {
    return deps.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    }))
  }

  /** The tool and arguments of a `tools/call`, or the JSON-RPC refusal. */
  function readToolCall(
    audit: Audit,
    id: RpcId,
    params: unknown,
  ): { tool: McpTool; args: Json } | Response {
    if (!isPlainObject(params) || typeof params.name !== 'string' || params.name === '') {
      audit.outcome = 'invalid_params'
      return rpcError(200, id, CODE.invalidParams, 'tools/call needs params.name')
    }
    const tool = byName.get(params.name)
    if (tool === undefined) {
      audit.outcome = 'unknown_tool'
      return rpcError(200, id, CODE.invalidParams, 'unknown tool')
    }
    audit.tool = tool.name
    const rawArgs = params.arguments ?? {}
    if (!isPlainObject(rawArgs)) {
      audit.outcome = 'invalid_params'
      return rpcError(200, id, CODE.invalidParams, 'arguments must be a JSON object')
    }
    return { tool, args: rawArgs }
  }

  async function callTool(
    audit: Audit,
    id: RpcId,
    params: unknown,
    caller: McpCaller,
  ): Promise<Response> {
    const call = readToolCall(audit, id, params)
    if (call instanceof Response) return call

    try {
      // Arguments are checked before the summary is built, so a summary only
      // ever holds values that passed the tool's own validation.
      const run = call.tool.prepare(call.args)
      audit.args = run.summary
      const read = await run.execute(deps.contextFor(caller.auth), { masked: caller.masked })
      if (!read.ok) {
        audit.outcome = read.error
        return toolError(id, `${read.error}: ${read.message}`)
      }
      audit.outcome = 'ok'
      audit.resultCount = read.count
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(read.body) }],
        structuredContent: read.body,
        isError: false,
      })
    } catch (error) {
      if (error instanceof McpArgumentError) {
        audit.outcome = 'invalid_arguments'
        return toolError(id, `invalid_arguments: ${error.message}`)
      }
      audit.outcome = 'internal_error'
      audit.detail = error instanceof Error ? error.name : 'unknown'
      return rpcError(500, id, CODE.internalError, 'internal error')
    }
  }

  function invalidRequest(audit: Audit, id: RpcId | null, text: string): Response {
    audit.outcome = 'invalid_request'
    return rpcError(400, id, CODE.invalidRequest, text)
  }

  /**
   * The id and method of a request, `null` for a message that needs no answer
   * (a notification, or a response to a server request: there are none), or
   * the refusal.
   */
  function readEnvelope(
    audit: Audit,
    message: Json,
  ): { id: RpcId; method: string } | null | Response {
    if (message.jsonrpc !== '2.0') return invalidRequest(audit, null, 'jsonrpc must be "2.0"')
    const method = typeof message.method === 'string' ? message.method : ''
    audit.rpcMethod = recordedMethod(method)

    const id = message.id
    if (id === undefined) {
      return isAnswerless(message, method)
        ? null
        : invalidRequest(audit, null, 'method is required')
    }
    if (!isValidId(id)) {
      return invalidRequest(audit, null, 'id must be a string or an integer')
    }
    if (method === '') return invalidRequest(audit, id, 'method is required')
    return { id, method }
  }

  async function dispatch(audit: Audit, message: Json, caller: McpCaller): Promise<Response> {
    const envelope = readEnvelope(audit, message)
    if (envelope instanceof Response) return envelope
    if (envelope === null) {
      audit.outcome = 'notification'
      return new Response(null, { status: 202, headers: BASE_HEADERS })
    }
    const { id, method } = envelope
    if (method === 'tools/call') return callTool(audit, id, message.params, caller)

    audit.outcome = 'ok'
    switch (method) {
      case 'initialize': {
        const params = message.params
        const requested = isPlainObject(params) ? params.protocolVersion : undefined
        return rpcResult(id, {
          protocolVersion: isSupportedVersion(requested) ? requested : MCP_LATEST_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: MCP_SERVER_INFO,
          instructions: MCP_INSTRUCTIONS,
        })
      }
      case 'ping':
        return rpcResult(id, {})
      case 'tools/list':
        return rpcResult(id, { tools: toolList() })
      default:
        audit.outcome = 'method_not_found'
        return rpcError(200, id, CODE.methodNotFound, 'method not found')
    }
  }

  function refusal(audit: Audit, caller: McpRefusal): Response {
    audit.clientId = caller.clientId ?? null
    audit.detail = caller.reason
    if (caller.status === 503) {
      audit.outcome = 'verifier_unavailable'
      return unavailable(caller.error)
    }
    if (caller.status === 401) {
      audit.outcome = 'unauthenticated'
      return json(
        401,
        {
          error: 'invalid_token',
          error_description: 'A valid Janua machine token for this service is required',
        },
        { 'www-authenticate': `Bearer ${MCP_REALM}, error="invalid_token"` },
      )
    }
    audit.outcome = `denied_${caller.error}`
    const challenge = `Bearer ${MCP_REALM}, error="insufficient_scope", scope="${MCP_READ_SCOPE}"`
    return json(
      403,
      { error: caller.error },
      caller.error === 'insufficient_scope' ? { 'www-authenticate': challenge } : {},
    )
  }

  function unavailable(error: string): Response {
    return json(503, { error }, { 'retry-after': String(MCP_UNAVAILABLE_RETRY_AFTER_SECONDS) })
  }

  /** A refusal of a rate gate: 503 when the limiter is down, else 429. */
  function rateRefusal(
    audit: Audit,
    decision: Exclude<McpRateDecision, { allowed: true }>,
    outcome: string,
    text: string,
  ): Response {
    if (decision.unavailable) {
      audit.outcome = 'limiter_unavailable'
      return unavailable('rate_limiter_unavailable')
    }
    audit.outcome = outcome
    return rpcError(429, null, CODE.rateLimited, text, {
      'retry-after': String(Math.max(1, Math.ceil(decision.retryAfterSeconds))),
    })
  }

  /** Gates 1 to 4: who is calling, or the refusal. */
  async function admit(request: Request, audit: Audit): Promise<McpCaller | Response> {
    const byAddress = await deps.allowIp(clientAddress(request.headers))
    if (!byAddress.allowed) {
      return rateRefusal(audit, byAddress, 'rate_limited_ip', 'rate limit exceeded')
    }
    if (request.headers.get('origin') !== null) {
      audit.outcome = 'origin_refused'
      return json(403, {
        error: 'origin_not_allowed',
        message: 'The MCP serves machine clients; browser origins are refused',
      })
    }
    const caller = await deps.verify(request.headers.get('authorization'))
    if (!caller.ok) return refusal(audit, caller)
    audit.clientId = caller.clientId
    audit.tenantId = caller.auth.tenantId
    audit.masked = caller.masked

    const byClient = await deps.allowClient(caller.clientId)
    if (!byClient.allowed) {
      return rateRefusal(audit, byClient, 'rate_limited', 'rate limit exceeded for this client')
    }
    return caller
  }

  /** Gate 5: the one JSON-RPC message of the body, or the refusal. */
  async function readMessage(request: Request, audit: Audit): Promise<Json | Response> {
    const refuse = (status: number, outcome: string, code: number, text: string) => {
      audit.outcome = outcome
      return rpcError(status, null, code, text)
    }
    const version = request.headers.get('mcp-protocol-version')
    if (version !== null && !isSupportedVersion(version)) {
      return refuse(
        400,
        'unsupported_protocol_version',
        CODE.invalidRequest,
        'unsupported MCP-Protocol-Version',
      )
    }
    const mediaType = (request.headers.get('content-type') ?? '').split(';')[0]?.trim()
    if (mediaType?.toLowerCase() !== 'application/json') {
      return refuse(
        415,
        'unsupported_media_type',
        CODE.invalidRequest,
        'Content-Type must be application/json',
      )
    }
    const body = await readCapped(request, MCP_MAX_BODY_BYTES)
    if (body === null) {
      return refuse(413, 'too_large', CODE.invalidRequest, 'request body exceeds 64 KiB')
    }
    const trimmed = body.trim()
    if (trimmed.startsWith('[')) {
      return refuse(400, 'invalid_request', CODE.invalidRequest, 'batch requests are not supported')
    }
    let message: unknown
    try {
      message = JSON.parse(trimmed)
    } catch {
      message = null
    }
    return isPlainObject(message)
      ? message
      : refuse(400, 'parse_error', CODE.parseError, 'the body is not a JSON-RPC message')
  }

  async function gate(request: Request, audit: Audit): Promise<Response> {
    const caller = await admit(request, audit)
    if (caller instanceof Response) return caller
    const message = await readMessage(request, audit)
    if (message instanceof Response) return message
    return dispatch(audit, message, caller)
  }

  async function handle(request: Request): Promise<Response> {
    const audit: Audit = {
      event: 'mcp_call',
      start: deps.now(),
      clientId: null,
      tenantId: null,
      rpcMethod: '',
      tool: null,
      outcome: '',
      resultCount: null,
      args: null,
      detail: null,
      masked: null,
    }
    let response: Response
    try {
      response = await gate(request, audit)
    } catch (error) {
      audit.outcome = 'internal_error'
      audit.detail = error instanceof Error ? error.name : 'unknown'
      response = rpcError(500, null, CODE.internalError, 'internal error')
    }
    const { start, ...record } = audit
    deps.audit({
      ...record,
      httpStatus: response.status,
      latencyMs: Math.round((deps.now() - start) * 1000) / 1000,
    })
    return response
  }

  return { handle, tools: deps.tools }
}

export type McpServer = ReturnType<typeof createMcpServer>

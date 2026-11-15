/**
 * The shape of an MCP tool and the argument readers the tools share.
 *
 * A tool runs in two steps so the audit record can never hold an unchecked
 * value: `prepare(args)` validates the arguments (throwing `McpArgumentError`
 * for anything the caller can fix) and returns the audit summary plus
 * `execute(ctx)`, which calls the service layer.
 */
import type { ServiceContext } from '@phynd/services/context'

import { MCP_DEFAULT_PAGE_SIZE, MCP_MAX_PAGE_SIZE } from './settings'

/** An argument problem the caller can fix: answered as a tool result with `isError`. */
export class McpArgumentError extends Error {}

export type McpArgs = Readonly<Record<string, unknown>>

/** Identifiers, enumerations, numbers and flags only. Never free text. */
export type McpArgsSummary = Readonly<Record<string, string | number | boolean>>

export type McpToolResult =
  | { ok: true; body: Record<string, unknown>; count: number }
  | { ok: false; error: 'not_found'; message: string }

/** How the caller sees personal fields: decided by `lib/mcp/auth.ts`, masked by default. */
export interface McpView {
  readonly masked: boolean
}

export interface McpToolRun {
  summary: McpArgsSummary
  execute: (ctx: ServiceContext, view: McpView) => Promise<McpToolResult>
}

export interface McpTool {
  /** Wire name, `^[a-zA-Z0-9_-]{1,64}$`. */
  readonly name: string
  /** Dotted catalog name. */
  readonly title: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly outputSchema: Readonly<Record<string, unknown>>
  /** Validates `args`; throws McpArgumentError for arguments the caller can fix. */
  readonly prepare: (args: McpArgs) => McpToolRun
}

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

// ── Patterns shared by the input schemas and the readers ────────────────────

/** Generated row ids (contacts, leads, deals, users, activities) are UUIDs. */
export const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
/** Pipeline and stage ids are seeded names (`stage_default_new`), not UUIDs. */
export const ENTITY_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
/** A cursor is the id of the last row of the previous page. */
export const CURSOR_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
export const SOURCE_PATTERN = '^[A-Za-z0-9][A-Za-z0-9 _.:/-]{0,99}$'

const UUID = new RegExp(UUID_PATTERN)
const ENTITY_ID = new RegExp(ENTITY_ID_PATTERN)
const CURSOR = new RegExp(CURSOR_PATTERN)
const SOURCE = new RegExp(SOURCE_PATTERN)
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/

// ── Schema fragments ─────────────────────────────────────────────────────────

export const CURSOR_SCHEMA = {
  type: 'string',
  pattern: CURSOR_PATTERN,
  description: 'next_cursor of the previous page (use the same filters).',
} as const

export const LIMIT_SCHEMA = {
  type: 'integer',
  minimum: 1,
  maximum: MCP_MAX_PAGE_SIZE,
  description: `Page size, default ${String(MCP_DEFAULT_PAGE_SIZE)}, at most ${String(MCP_MAX_PAGE_SIZE)}.`,
} as const

export const OWNER_ID_SCHEMA = {
  type: 'string',
  pattern: UUID_PATTERN,
  description: 'Only rows owned by this CRM user id (the owner_id of any row).',
} as const

// ── Readers ──────────────────────────────────────────────────────────────────

export function onlyArgs(args: McpArgs, allowed: readonly string[]): void {
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    // Counted, not echoed: an unknown key is caller-chosen text.
    throw new McpArgumentError(
      `${String(unknown.length)} unknown argument(s) (allowed: ${allowed.join(', ') || 'none'})`,
    )
  }
}

function optionalString(args: McpArgs, name: string): string | null {
  const value = args[name]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new McpArgumentError(`${name} must be a string`)
  return value
}

function matching(args: McpArgs, name: string, pattern: RegExp, what: string): string | null {
  const value = optionalString(args, name)
  if (value !== null && !pattern.test(value)) throw new McpArgumentError(`${name} must be ${what}`)
  return value
}

export function optionalUuid(args: McpArgs, name: string): string | null {
  return matching(args, name, UUID, 'a UUID')
}

export function requiredUuid(args: McpArgs, name: string): string {
  const value = optionalUuid(args, name)
  if (value === null) throw new McpArgumentError(`${name} is required`)
  return value
}

export function optionalEntityId(args: McpArgs, name: string): string | null {
  return matching(args, name, ENTITY_ID, 'an id')
}

export function optionalSource(args: McpArgs, name: string): string | null {
  return matching(args, name, SOURCE, 'a source name of at most 100 characters')
}

export function optionalEnum<T extends string>(
  args: McpArgs,
  name: string,
  values: readonly T[],
): T | null {
  const value = optionalString(args, name)
  if (value === null) return null
  if (!(values as readonly string[]).includes(value)) {
    throw new McpArgumentError(`${name} must be one of: ${values.join(', ')}`)
  }
  return value as T
}

/** Free text of 1 to `max` characters after trimming; null when absent. */
export function optionalText(args: McpArgs, name: string, max: number): string | null {
  const value = optionalString(args, name)?.trim() ?? null
  if (value === null) return null
  if (value.length === 0 || value.length > max) {
    throw new McpArgumentError(`${name} must be 1 to ${String(max)} characters`)
  }
  return value
}

/** An ISO 8601 instant with an explicit offset (`2026-11-14T00:00:00-06:00`). */
export function optionalInstant(args: McpArgs, name: string): Date | null {
  const value = optionalString(args, name)
  if (value === null) return null
  const date = ISO_INSTANT.test(value) ? new Date(value) : null
  if (date === null || Number.isNaN(date.getTime())) {
    throw new McpArgumentError(`${name} must be an ISO 8601 date-time with a UTC offset`)
  }
  return date
}

function boundedInteger(args: McpArgs, name: string, max: number, fallback: number): number {
  const value = args[name]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new McpArgumentError(`${name} must be an integer from 1 to ${String(max)}`)
  }
  return value
}

/** The page size: refused above the cap, never silently widened. */
export function pageLimit(args: McpArgs, name = 'limit'): number {
  return boundedInteger(args, name, MCP_MAX_PAGE_SIZE, MCP_DEFAULT_PAGE_SIZE)
}

export function optionalCursor(args: McpArgs): string | null {
  return matching(args, 'cursor', CURSOR, 'the next_cursor of a previous page')
}

/** Drops absent values so a summary lists only the arguments that were sent. */
export function summarize(
  values: Readonly<Record<string, string | number | boolean | null>>,
): McpArgsSummary {
  const summary: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) summary[key] = value
  }
  return summary
}

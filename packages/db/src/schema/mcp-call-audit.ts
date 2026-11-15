import { boolean, index, integer, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { createId } from './utils'

/**
 * One row per `tools/call` a verified machine client makes on the native MCP
 * (`apps/web/src/lib/mcp/`). Written before the call answers: when the insert
 * fails the call fails and returns nothing, so no read leaves unrecorded.
 *
 * No personal data: `args` is the same identifiers-and-enumerations summary
 * the `web:mcp` log line carries (search text only as `has_query`, a source
 * filter only as `has_source`), never row content. Retention: see
 * `docs/NATIVE_MCP.md` § Audit (no deletion job yet).
 */
export const mcpCallAudit = pgTable(
  'mcp_call_audit',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    calledAt: timestamp('called_at', { withTimezone: true }).notNull().defaultNow(),
    // Janua client id of the verified caller (`service:<client_id>` without the prefix).
    clientId: varchar('client_id', { length: 255 }).notNull(),
    tenantId: varchar('tenant_id', { length: 100 }).notNull(),
    // A tool name from the fixed catalog; null when the call named no known tool.
    tool: varchar('tool', { length: 64 }),
    args: jsonb('args').$type<Record<string, string | number | boolean>>(),
    // `ok`, a tool refusal (`not_found`, `invalid_arguments`), a protocol
    // refusal (`unknown_tool`, `invalid_params`) or `internal_error`.
    outcome: varchar('outcome', { length: 50 }).notNull(),
    // Rows returned by a successful call; null otherwise.
    resultCount: integer('result_count'),
    // Whether personal fields were masked in the response.
    masked: boolean('masked').notNull(),
  },
  (table) => [
    index('mcp_call_audit_called_at_idx').on(table.calledAt),
    index('mcp_call_audit_client_called_at_idx').on(table.clientId, table.calledAt),
  ],
)

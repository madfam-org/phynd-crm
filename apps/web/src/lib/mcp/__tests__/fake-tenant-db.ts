/**
 * An in-memory tenant database for the MCP tests.
 *
 * It is a REAL drizzle database (`drizzle-orm/pg-proxy`): the services build
 * their queries exactly as in production, and this module answers the SQL they
 * produce by evaluating it against fixture rows. So a filter the service drops
 * (the soft-delete predicate, an owner filter, the page limit) changes what
 * these tests see, which is the point: nothing here re-implements a service.
 *
 * It understands only the single-table reads the tools make:
 *   select <columns> from "<table>" [where <predicates>] [order by …] [limit $n]
 * with predicates `is null`, `=`, `>`, `>=`, `<` (ANDed) and one OR group of
 * `ilike`. Anything else throws, so an unsupported query can never pass
 * silently. Rows are keyed by column name (`deleted_at`); instants are ISO
 * strings.
 */
import { drizzle } from 'drizzle-orm/pg-proxy'

export type FakeRow = Readonly<Record<string, string | number | boolean | null>>
export type FakeTables = Readonly<Record<string, readonly FakeRow[]>>

export interface FakeQuery {
  sql: string
  params: readonly unknown[]
  table: string
}

type Check = (row: FakeRow) => boolean

const ISO = /^\d{4}-\d{2}-\d{2}T/

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const left = String(a ?? '')
  const right = String(b ?? '')
  if (ISO.test(left) && ISO.test(right)) return Date.parse(left) - Date.parse(right)
  return left < right ? -1 : left > right ? 1 : 0
}

/** A SQL `LIKE` pattern (with `\` escapes) as a case-insensitive RegExp. */
function likeToRegExp(pattern: string): RegExp {
  let source = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern.charAt(i)
    if (char === '\\' && i + 1 < pattern.length) {
      i += 1
      source += pattern.charAt(i).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    } else if (char === '%') {
      source += '.*'
    } else if (char === '_') {
      source += '.'
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`, 'i')
}

const OPERATORS: Readonly<Record<string, (order: number) => boolean>> = {
  '=': (order) => order === 0,
  '>': (order) => order > 0,
  '>=': (order) => order >= 0,
  '<': (order) => order < 0,
  '<=': (order) => order <= 0,
}

function parseWhere(where: string, table: string, params: readonly unknown[]): Check {
  const all: Check[] = []
  const any: Check[] = []
  const column = `"${table}"\\."(\\w+)"`
  const param = (index: string) => params[Number(index) - 1]

  let rest = where
  rest = rest.replace(new RegExp(`${column} is null`, 'g'), (_m, name: string) => {
    all.push((row) => (row[name] ?? null) === null)
    return ''
  })
  rest = rest.replace(
    new RegExp(`${column} ilike \\$(\\d+)`, 'g'),
    (_m, name: string, n: string) => {
      const pattern = likeToRegExp(String(param(n)))
      any.push((row) => pattern.test(String(row[name] ?? '\u0000')))
      return ''
    },
  )
  rest = rest.replace(
    new RegExp(`${column} (>=|<=|=|>|<) \\$(\\d+)`, 'g'),
    (_m, name: string, operator: string, n: string) => {
      const holds = OPERATORS[operator]
      if (!holds) throw new Error(`fake-tenant-db: unsupported operator ${operator}`)
      // SQL comparisons with NULL are never true.
      all.push((row) => (row[name] ?? null) !== null && holds(compare(row[name], param(n))))
      return ''
    },
  )

  const leftover = rest.replace(/\b(and|or)\b|[()\s]/g, '')
  if (leftover !== '') throw new Error(`fake-tenant-db: unsupported predicate in: ${where}`)
  if (/\bor\b/.test(rest) && any.length === 0) {
    throw new Error(`fake-tenant-db: unsupported OR in: ${where}`)
  }
  return (row) => all.every((check) => check(row)) && (any.length === 0 || any.some((c) => c(row)))
}

function run(tables: FakeTables, sql: string, params: readonly unknown[]) {
  const match =
    /^select (.+?) from "(\w+)"(?: where (.+?))?(?: order by (.+?))?(?: limit \$(\d+))?$/.exec(
      sql.trim(),
    )
  if (!match) throw new Error(`fake-tenant-db: unsupported query: ${sql}`)
  const [, columnList = '', table = '', where, orderBy, limitParam] = match
  const columns = columnList.split(',').map((item) => {
    const name = /^"(\w+)"$/.exec(item.trim())?.[1]
    if (!name) throw new Error(`fake-tenant-db: unsupported column: ${item}`)
    return name
  })

  let rows = [...(tables[table] ?? [])]
  if (where) rows = rows.filter(parseWhere(where, table, params))
  if (orderBy) {
    const keys = orderBy.split(',').map((item) => {
      const parsed = new RegExp(`^"${table}"\\."(\\w+)"(?: (asc|desc))?$`).exec(item.trim())
      if (!parsed?.[1]) throw new Error(`fake-tenant-db: unsupported order: ${item}`)
      return { name: parsed[1], sign: parsed[2] === 'desc' ? -1 : 1 }
    })
    rows.sort((a, b) => {
      for (const key of keys) {
        const order = compare(a[key.name], b[key.name]) * key.sign
        if (order !== 0) return order
      }
      return 0
    })
  }
  if (limitParam) rows = rows.slice(0, Number(params[Number(limitParam) - 1]))
  return { table, rows: rows.map((row) => columns.map((name) => row[name] ?? null)) }
}

export function createFakeTenantDb(tables: FakeTables) {
  const queries: FakeQuery[] = []
  const db = drizzle(async (sql, params) => {
    const result = run(tables, sql, params)
    queries.push({ sql, params, table: result.table })
    return { rows: result.rows }
  })
  return { db, queries }
}

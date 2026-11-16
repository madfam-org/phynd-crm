/**
 * In-memory stand-in for the database behind `getDb()` in the staff-gate
 * tests. It holds a `users` table and answers the real Drizzle queries the
 * resolver and UsersService build, by decoding their where-clause with
 * Drizzle's own PgDialect. Inserts into any table are recorded in `inserted`;
 * reads of other tables return no rows.
 */
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

export interface FakeUserRow {
  id: string
  email: string
  name?: string | null
  role: string
  externalJanuaId: string | null
}

const dialect = new PgDialect()

function tableName(table: unknown): string {
  return (table as Record<symbol, string> | undefined)?.[Symbol.for('drizzle:Name')] ?? ''
}

type Query = Record<string, unknown> & { _table?: unknown; _where?: unknown; _set?: unknown }

function chain(result: (q: Query) => unknown[]) {
  const q: Query = {}
  for (const m of ['from', 'where', 'limit', 'orderBy', 'returning', 'set', 'values']) {
    q[m] = (arg?: unknown) => {
      if (m === 'from') q._table = arg
      if (m === 'where') q._where = arg
      if (m === 'set' || m === 'values') q._set = arg
      return q
    }
  }
  Object.defineProperty(q, 'then', {
    value: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
      try {
        resolve(result(q))
      } catch (e) {
        reject(e)
      }
    },
  })
  return q
}

export function createFakeUsersDb() {
  const users: FakeUserRow[] = []
  const inserted: Array<Record<string, unknown>> = []
  let lookups = 0

  function matching(where: unknown): FakeUserRow[] {
    if (!where) return [...users]
    const { sql, params } = dialect.sqlToQuery(where as SQL)
    const param = params[0]
    if (sql.includes('"role" =') && sql.includes('"external_janua_id" is not null')) {
      return users.filter((u) => u.role === param && u.externalJanuaId)
    }
    if (sql.includes('"external_janua_id" =')) {
      return users.filter((u) => u.externalJanuaId === param)
    }
    if (sql.includes('"id" =')) {
      const rows = users.filter((u) => u.id === param)
      return sql.includes('"external_janua_id" is null')
        ? rows.filter((u) => !u.externalJanuaId)
        : rows
    }
    throw new Error(`fake users db: unsupported where clause: ${sql}`)
  }

  return {
    users,
    inserted,
    /** Number of reads of the users table. */
    get lookups() {
      return lookups
    },
    reset() {
      users.length = 0
      inserted.length = 0
      lookups = 0
    },
    /** A CRM user linked to a Janua subject. */
    link(januaSub: string, id: string, role = 'sales_rep', email = `${id}@example.test`) {
      users.push({ id, email, role, externalJanuaId: januaSub })
    },
    byId(id: string) {
      return users.find((u) => u.id === id)
    },
    select() {
      return chain((q) => {
        if (tableName(q._table) !== 'users') return []
        lookups++
        return matching(q._where).map((u) => ({ ...u }))
      })
    },
    insert(table: unknown) {
      return chain((q) => {
        const values = (q._set ?? {}) as Record<string, unknown>
        inserted.push(values)
        const id = `row-${inserted.length - 1}`
        if (tableName(table) === 'users') {
          const sub = (values.externalJanuaId as string | undefined) ?? null
          if (sub && users.some((u) => u.externalJanuaId === sub)) {
            throw Object.assign(new Error('duplicate key'), { code: '23505' })
          }
          users.push({
            id,
            email: values.email as string,
            name: (values.name as string | undefined) ?? null,
            role: (values.role as string | undefined) ?? 'viewer',
            externalJanuaId: sub,
          })
        }
        return [{ id, ...values }]
      })
    },
    delete(table: unknown) {
      return chain((q) => {
        if (tableName(table) !== 'users') return []
        const rows = matching(q._where)
        for (const row of rows) users.splice(users.indexOf(row), 1)
        return rows.map((u) => ({ ...u }))
      })
    },
    update(table: unknown) {
      return chain((q) => {
        if (tableName(table) !== 'users') return []
        const rows = matching(q._where)
        for (const row of rows) Object.assign(row, q._set)
        return rows.map((u) => ({ ...u }))
      })
    },
  }
}

export type FakeUsersDb = ReturnType<typeof createFakeUsersDb>

import { resolveDatabaseUrl } from '@phynd/config/connections'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index'

const dbCache = new Map<string, ReturnType<typeof createClient>>()

function createClient(connectionString: string) {
  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  })
  return drizzle(sql, { schema })
}

export function getDb(tenantId = 'madfam'): ReturnType<typeof createClient> {
  if (dbCache.has(tenantId)) {
    return dbCache.get(tenantId)!
  }

  // Validates the URL and throws an error that names the offending env var
  // (DATABASE_URL or DATABASE_URL_<TENANT>) instead of a bare "Invalid URL".
  const url = resolveDatabaseUrl(tenantId)

  const db = createClient(url)
  dbCache.set(tenantId, db)
  return db
}

export type Database = ReturnType<typeof createClient>

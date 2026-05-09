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

  let url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is required')
  }

  if (tenantId !== 'madfam') {
    const tenantEnvVar = `DATABASE_URL_${tenantId.toUpperCase()}`
    if (process.env[tenantEnvVar]) {
      url = process.env[tenantEnvVar] as string
    } else {
      console.warn(
        `No specific DATABASE_URL found for tenant ${tenantId}, falling back to default.`,
      )
    }
  }

  const db = createClient(url)
  dbCache.set(tenantId, db)
  return db
}

export type Database = ReturnType<typeof createClient>

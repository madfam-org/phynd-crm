import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index'

let db: ReturnType<typeof createClient> | null = null

function createClient(connectionString: string) {
  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  })
  return drizzle(sql, { schema })
}

export function getDb(connectionString?: string): ReturnType<typeof createClient> {
  if (db) return db
  const url = connectionString ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is required')
  }
  db = createClient(url)
  return db
}

export type Database = ReturnType<typeof getDb>

import { integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { createId } from './utils'

export const healthSnapshots = pgTable('health_snapshots', {
  id: text('id').primaryKey().$defaultFn(createId),
  provider: varchar('provider', { length: 50 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  latencyMs: integer('latency_ms'),
  circuitState: varchar('circuit_state', { length: 20 }).notNull(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
})

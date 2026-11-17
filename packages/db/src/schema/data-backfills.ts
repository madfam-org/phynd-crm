import { jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core'

/**
 * One row per data backfill that has finished. A backfill that needs runtime
 * configuration (and so cannot be a SQL migration) runs from the worker at
 * start-up, once: it is skipped when its `name` is here. `summary` holds
 * counts only, never personal data.
 */
export const dataBackfills = pgTable('data_backfills', {
  name: varchar('name', { length: 100 }).primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  summary: jsonb('summary').$type<Record<string, number>>(),
})

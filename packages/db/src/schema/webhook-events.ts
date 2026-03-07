import { jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { createId } from './utils'

export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey().$defaultFn(createId),
  provider: varchar('provider', { length: 20 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

import { jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { createId } from './utils'

export const externalReferences = pgTable('external_references', {
  id: text('id').primaryKey().$defaultFn(createId),
  entityType: varchar('entity_type', { length: 20 }).notNull(),
  entityId: text('entity_id').notNull(),
  provider: varchar('provider', { length: 20 }).notNull(),
  externalId: varchar('external_id', { length: 255 }).notNull(),
  externalType: varchar('external_type', { length: 100 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

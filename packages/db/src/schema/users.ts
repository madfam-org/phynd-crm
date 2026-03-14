import { pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'
import { createId } from './utils'

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    externalJanuaId: varchar('external_janua_id', { length: 255 }),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }),
    role: varchar('role', { length: 50 }).notNull().default('viewer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('users_external_janua_id_uniq').on(table.externalJanuaId)],
)

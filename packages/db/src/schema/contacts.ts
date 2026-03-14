import { pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'
import { createId } from './utils'

export const contacts = pgTable(
  'contacts',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    externalJanuaId: varchar('external_janua_id', { length: 255 }),
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    company: varchar('company', { length: 255 }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    ownerId: text('owner_id').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('contacts_external_janua_id_uniq').on(table.externalJanuaId)],
)

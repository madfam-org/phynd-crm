import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { createId } from './utils'

export const contacts = pgTable('contacts', {
  id: text('id').primaryKey().$defaultFn(createId),
  externalJanuaId: varchar('external_janua_id', { length: 255 }),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  company: varchar('company', { length: 255 }),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  ownerId: text('owner_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
})

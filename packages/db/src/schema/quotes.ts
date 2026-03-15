import { index, numeric, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { contacts } from './contacts'
import { opportunities } from './opportunities'
import { users } from './users'
import { createId } from './utils'

export const quotes = pgTable(
  'quotes',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    quoteNumber: varchar('quote_number', { length: 50 }).notNull(),
    opportunityId: text('opportunity_id').references(() => opportunities.id),
    contactId: text('contact_id').references(() => contacts.id),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }),
    currency: varchar('currency', { length: 10 }).notNull().default('USD'),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    ownerId: text('owner_id').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('quotes_opportunity_id_idx').on(table.opportunityId),
    index('quotes_contact_id_idx').on(table.contactId),
  ],
)

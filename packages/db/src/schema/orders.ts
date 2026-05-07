import { index, numeric, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { contacts } from './contacts'
import { opportunities } from './opportunities'
import { quotes } from './quotes'
import { users } from './users'
import { createId } from './utils'

export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    orderNumber: varchar('order_number', { length: 50 }).notNull(),
    opportunityId: text('opportunity_id').references(() => opportunities.id),
    quoteId: text('quote_id').references(() => quotes.id),
    contactId: text('contact_id').references(() => contacts.id),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    paymentStatus: varchar('payment_status', { length: 20 }).notNull().default('unpaid'),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }),
    paidAmount: numeric('paid_amount', { precision: 12, scale: 2 }),
    currency: varchar('currency', { length: 10 }).notNull().default('USD'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paymentProvider: varchar('payment_provider', { length: 20 }),
    externalPaymentId: varchar('external_payment_id', { length: 255 }),
    estimatedCompletion: timestamp('estimated_completion', { withTimezone: true }),
    actualCompletion: timestamp('actual_completion', { withTimezone: true }),
    ownerId: text('owner_id').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('orders_opportunity_id_idx').on(table.opportunityId),
    index('orders_contact_id_idx').on(table.contactId),
    index('orders_quote_id_idx').on(table.quoteId),
  ],
)

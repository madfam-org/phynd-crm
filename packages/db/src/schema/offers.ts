import { integer, numeric, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { createId } from './utils'

export const offers = pgTable('offers', {
  id: text('id').primaryKey().$defaultFn(createId),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  type: varchar('type', { length: 20 }).notNull().default('custom'),
  value: numeric('value', { precision: 12, scale: 2 }),
  currency: varchar('currency', { length: 3 }),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  maxRedemptions: integer('max_redemptions'),
  currentRedemptions: integer('current_redemptions').notNull().default(0),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  externalProductId: varchar('external_product_id', { length: 255 }),
  externalProvider: varchar('external_provider', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

import { numeric, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { offers } from './offers'
import { createId } from './utils'

export const campaigns = pgTable('campaigns', {
  id: text('id').primaryKey().$defaultFn(createId),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  channel: varchar('channel', { length: 30 }).notNull().default('other'),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  utmSource: varchar('utm_source', { length: 255 }),
  utmMedium: varchar('utm_medium', { length: 255 }),
  utmCampaign: varchar('utm_campaign', { length: 255 }),
  budget: numeric('budget', { precision: 12, scale: 2 }),
  currency: varchar('currency', { length: 3 }),
  startDate: timestamp('start_date', { withTimezone: true }),
  endDate: timestamp('end_date', { withTimezone: true }),
  offerId: text('offer_id').references(() => offers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

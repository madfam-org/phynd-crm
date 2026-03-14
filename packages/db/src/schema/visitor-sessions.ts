import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { contacts } from './contacts'
import { createId } from './utils'

export const visitorSessions = pgTable(
  'visitor_sessions',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    externalSessionId: varchar('external_session_id', { length: 255 }).notNull(),
    fingerprint: varchar('fingerprint', { length: 255 }),
    contactId: text('contact_id').references(() => contacts.id),
    identified: boolean('identified').notNull().default(false),
    ipCity: varchar('ip_city', { length: 100 }),
    ipCountry: varchar('ip_country', { length: 100 }),
    deviceType: varchar('device_type', { length: 50 }),
    browser: varchar('browser', { length: 100 }),
    os: varchar('os', { length: 100 }),
    referrer: text('referrer'),
    utmSource: varchar('utm_source', { length: 255 }),
    utmMedium: varchar('utm_medium', { length: 255 }),
    utmCampaign: varchar('utm_campaign', { length: 255 }),
    utmTerm: varchar('utm_term', { length: 255 }),
    utmContent: varchar('utm_content', { length: 255 }),
    pageViewCount: integer('page_view_count').notNull().default(0),
    duration: integer('duration'),
    metadata: jsonb('metadata'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('visitor_sessions_contact_id_idx').on(table.contactId),
    uniqueIndex('visitor_sessions_external_id_uniq').on(table.externalSessionId),
  ],
)

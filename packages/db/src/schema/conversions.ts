import { jsonb, numeric, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { campaigns } from './campaigns'
import { contacts } from './contacts'
import { leads } from './leads'
import { opportunities } from './opportunities'
import { createId } from './utils'
import { visitorSessions } from './visitor-sessions'

export const conversions = pgTable('conversions', {
  id: text('id').primaryKey().$defaultFn(createId),
  type: varchar('type', { length: 30 }).notNull(),
  contactId: text('contact_id').references(() => contacts.id),
  leadId: text('lead_id').references(() => leads.id),
  opportunityId: text('opportunity_id').references(() => opportunities.id),
  campaignId: text('campaign_id').references(() => campaigns.id),
  visitorSessionId: text('visitor_session_id').references(() => visitorSessions.id),
  value: numeric('value', { precision: 12, scale: 2 }),
  metadata: jsonb('metadata'),
  convertedAt: timestamp('converted_at', { withTimezone: true }).notNull().defaultNow(),
})

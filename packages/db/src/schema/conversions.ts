import { sql } from 'drizzle-orm'
import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { campaigns } from './campaigns'
import { contacts } from './contacts'
import { leads } from './leads'
import { opportunities } from './opportunities'
import { createId } from './utils'
import { visitorSessions } from './visitor-sessions'

export const conversions = pgTable(
  'conversions',
  {
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
  },
  (table) => [
    index('conversions_campaign_id_idx').on(table.campaignId),
    index('conversions_contact_id_idx').on(table.contactId),
    index('conversions_lead_id_idx').on(table.leadId),
    index('conversions_visitor_session_id_idx').on(table.visitorSessionId),
    uniqueIndex('conversions_type_lead_uniq')
      .on(table.type, table.leadId)
      .where(sql`lead_id IS NOT NULL`),
    uniqueIndex('conversions_type_opportunity_uniq')
      .on(table.type, table.opportunityId)
      .where(sql`opportunity_id IS NOT NULL`),
  ],
)

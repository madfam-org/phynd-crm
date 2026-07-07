import { index, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'
import { campaigns } from './campaigns'
import { contacts } from './contacts'
import { leads } from './leads'
import { createId } from './utils'

// ---------------------------------------------------------------------------
// Per-recipient email delivery/engagement events (Resend webhook ingestion +
// send-time records from the drip worker). Feeds campaign reporting and the
// Tulana buyer-signal export.
// ---------------------------------------------------------------------------

export const campaignEmailEvents = pgTable(
  'campaign_email_events',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    // Resend message id (data.email_id in webhook payloads)
    emailId: varchar('email_id', { length: 255 }),
    // Lowercase recipient email address
    recipient: varchar('recipient', { length: 255 }).notNull(),
    // sent | delivered | delivery_delayed | opened | clicked | bounced | complained
    eventType: varchar('event_type', { length: 32 }).notNull(),
    campaignId: text('campaign_id').references(() => campaigns.id),
    contactId: text('contact_id').references(() => contacts.id),
    leadId: text('lead_id').references(() => leads.id),
    // Clicked link target (clicked events only)
    url: text('url'),
    // Idempotency: svix message id for webhook events, `sent:<emailId>` for
    // send-time rows
    dedupKey: varchar('dedup_key', { length: 255 }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('campaign_email_events_dedup_key_uniq').on(table.dedupKey),
    index('campaign_email_events_campaign_id_idx').on(table.campaignId),
    index('campaign_email_events_contact_id_idx').on(table.contactId),
    index('campaign_email_events_email_id_idx').on(table.emailId),
    index('campaign_email_events_recipient_idx').on(table.recipient),
    index('campaign_email_events_occurred_at_idx').on(table.occurredAt),
  ],
)

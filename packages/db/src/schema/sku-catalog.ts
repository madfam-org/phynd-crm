import { index, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { campaigns } from './campaigns'
import { contacts } from './contacts'
import { createId } from './utils'

export const skuCatalog = pgTable('sku_catalog', {
  id: text('id').primaryKey().$defaultFn(createId),
  skuKey: varchar('sku_key', { length: 128 }).notNull().unique(),
  platform: varchar('platform', { length: 64 }).notNull(),
  audience: varchar('audience', { length: 255 }),
  gaReadiness: varchar('ga_readiness', { length: 32 }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const campaignImports = pgTable('campaign_imports', {
  idempotencyKey: varchar('idempotency_key', { length: 255 }).primaryKey(),
  campaignId: text('campaign_id')
    .notNull()
    .references(() => campaigns.id),
  source: varchar('source', { length: 32 }).notNull(),
  orchestrator: varchar('orchestrator', { length: 32 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const campaignBuyerSignals = pgTable(
  'campaign_buyer_signals',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    contactId: text('contact_id').references(() => contacts.id),
    skuKey: varchar('sku_key', { length: 128 }).notNull(),
    contactSegment: varchar('contact_segment', { length: 255 }),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    signalStrength: varchar('signal_strength', { length: 16 }),
    notesRedacted: text('notes_redacted'),
    dedupKey: varchar('dedup_key', { length: 255 }).notNull().unique(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('campaign_buyer_signals_campaign_id_idx').on(table.campaignId),
    index('campaign_buyer_signals_sku_key_idx').on(table.skuKey),
    index('campaign_buyer_signals_occurred_at_idx').on(table.occurredAt),
  ],
)

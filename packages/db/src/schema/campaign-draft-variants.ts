import { index, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { campaigns } from './campaigns'
import { createId } from './utils'

// ---------------------------------------------------------------------------
// Per-variant campaign draft copy handed off from Selva/Tulana. Structured
// variants mirror Selva's generate-copy output (variant_id, language,
// subject, preheader, body, cta, claim_keys_used) so the claims audit trail
// survives the draft → needs_review → approved flow. Legacy string variants
// are persisted with format='legacy_string' for wire compatibility.
// ---------------------------------------------------------------------------

export const campaignDraftVariants = pgTable(
  'campaign_draft_variants',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    // Selva generate-copy variant id (uuid); null for legacy string variants
    variantId: varchar('variant_id', { length: 64 }),
    // structured | legacy_string
    format: varchar('format', { length: 16 }).notNull().default('structured'),
    language: varchar('language', { length: 16 }),
    subject: varchar('subject', { length: 500 }),
    preheader: varchar('preheader', { length: 500 }),
    body: text('body').notNull(),
    cta: varchar('cta', { length: 500 }),
    // Landing/checkout URL the CTA button links to. Without it the CTA
    // renders as plain bold text and the conversion path is dead.
    ctaUrl: varchar('cta_url', { length: 1000 }),
    // Campaign-safe claim feature_keys grounding this variant (audit trail)
    claimKeysUsed: jsonb('claim_keys_used').$type<string[]>().notNull().default([]),
    source: varchar('source', { length: 32 }).notNull().default('tulana'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('campaign_draft_variants_campaign_id_idx').on(table.campaignId),
    index('campaign_draft_variants_variant_id_idx').on(table.variantId),
  ],
)

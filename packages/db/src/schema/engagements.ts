import { index, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { contacts } from './contacts'
import { opportunities } from './opportunities'
import { users } from './users'
import { createId } from './utils'

// Aggregate root tying a client engagement together: one client, one
// project family, potentially many quotes/orders (fab) + digital work
// (services). Status unified across Pravara (fab) + Selva (digital)
// via engagement_events writes.
export const engagements = pgTable(
  'engagements',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    // Nullable — a consulting-only engagement may not have a priced
    // opportunity record backing it.
    opportunityId: text('opportunity_id').references(() => opportunities.id),
    projectName: varchar('project_name', { length: 255 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    ownerId: text('owner_id').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('engagements_contact_id_idx').on(table.contactId),
    index('engagements_opportunity_id_idx').on(table.opportunityId),
    index('engagements_status_idx').on(table.status),
  ],
)

// Artifacts surfaced to the client in the portal: signed proposal PDFs,
// invoices, deliverables (digital URLs, shipping tracking numbers, NFT
// receipts). entityType+entityId match the existing polymorphic pattern
// (contact/lead/opportunity/order/quote) so the artifact can point at
// the canonical row.
export const engagementArtifacts = pgTable(
  'engagement_artifacts',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    engagementId: text('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    // 'quote' | 'signed_proposal' | 'invoice' | 'deliverable' | 'nft_receipt'
    type: varchar('type', { length: 30 }).notNull(),
    entityType: varchar('entity_type', { length: 20 }),
    entityId: text('entity_id'),
    url: text('url'),
    title: varchar('title', { length: 255 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('engagement_artifacts_engagement_id_idx').on(table.engagementId),
    index('engagement_artifacts_type_idx').on(table.type),
  ],
)

// Unified project status events. Written by Pravara (fab), Selva
// (digital), Cotiza (quote/proposal lifecycle), Karafiel (compliance
// stamping), Dhanam (billing), or 'system' (PhyneCRM-originated).
// Timeline is built by ORDER BY created_at, merged with activities +
// stage_transitions for the client portal view.
export const engagementEvents = pgTable(
  'engagement_events',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    engagementId: text('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    // 'pravara' | 'selva' | 'cotiza' | 'karafiel' | 'dhanam' | 'system'
    source: varchar('source', { length: 20 }).notNull(),
    // Free-form event name scoped to the source, e.g. pravara:shipped,
    // selva:milestone_complete, cotiza:proposal_approved.
    eventType: varchar('event_type', { length: 100 }).notNull(),
    // Optional high-level status to drive UI badges: pending /
    // in_progress / completed / failed / blocked.
    status: varchar('status', { length: 20 }),
    // Free-form human message for timeline display.
    message: text('message'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    // Deduplication key (source:external_id:event_type:timestamp). The
    // webhook handler sets this to skip reprocessing.
    dedupKey: varchar('dedup_key', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('engagement_events_engagement_id_idx').on(table.engagementId),
    index('engagement_events_source_idx').on(table.source),
    index('engagement_events_created_at_idx').on(table.createdAt),
    // Dedup-lookup index; scoped to engagement to keep it bounded.
    index('engagement_events_dedup_idx').on(table.engagementId, table.dedupKey),
  ],
)

export type Engagement = typeof engagements.$inferSelect
export type NewEngagement = typeof engagements.$inferInsert
export type EngagementArtifact = typeof engagementArtifacts.$inferSelect
export type NewEngagementArtifact = typeof engagementArtifacts.$inferInsert
export type EngagementEvent = typeof engagementEvents.$inferSelect
export type NewEngagementEvent = typeof engagementEvents.$inferInsert

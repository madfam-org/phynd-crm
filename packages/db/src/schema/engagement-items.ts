import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { contacts } from './contacts'
import { engagementArtifacts, engagements } from './engagements'
import { users } from './users'
import { createId } from './utils'

export const ENGAGEMENT_ITEM_KINDS = ['milestone', 'deliverable', 'actionable', 'decision'] as const
export type EngagementItemKind = (typeof ENGAGEMENT_ITEM_KINDS)[number]

export const ENGAGEMENT_ITEM_STATUSES = [
  'planned',
  'in_progress',
  'done',
  'blocked',
  'awaiting_client',
] as const
export type EngagementItemStatus = (typeof ENGAGEMENT_ITEM_STATUSES)[number]

// Whose move it is: MADFAM's team or the client.
export const ENGAGEMENT_ITEM_SIDES = ['madfam', 'client'] as const
export type EngagementItemSide = (typeof ENGAGEMENT_ITEM_SIDES)[number]

// Milestones, deliverables, actionables and decisions of an engagement. The
// client portal renders only rows with client_visible = true (default false).
export const engagementItems = pgTable(
  'engagement_items',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    engagementId: text('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 20 }).$type<EngagementItemKind>().notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 20 })
      .$type<EngagementItemStatus>()
      .notNull()
      .default('planned'),
    side: varchar('side', { length: 10 }).$type<EngagementItemSide>().notNull().default('madfam'),
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    clientVisible: boolean('client_visible').notNull().default(false),
    artifactId: text('artifact_id').references(() => engagementArtifacts.id, {
      onDelete: 'set null',
    }),
    // Stable id from an importer/feed (e.g. a madfam-ops manifest key).
    externalKey: varchar('external_key', { length: 200 }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('engagement_items_engagement_sort_idx').on(table.engagementId, table.sortOrder),
    index('engagement_items_client_visible_idx').on(table.engagementId, table.clientVisible),
    // NULL keys never collide, so only keyed rows are unique per engagement.
    uniqueIndex('engagement_items_external_key_uniq').on(table.engagementId, table.externalKey),
    check(
      'engagement_items_kind_check',
      sql`${table.kind} in ('milestone', 'deliverable', 'actionable', 'decision')`,
    ),
    check(
      'engagement_items_status_check',
      sql`${table.status} in ('planned', 'in_progress', 'done', 'blocked', 'awaiting_client')`,
    ),
    check('engagement_items_side_check', sql`${table.side} in ('madfam', 'client')`),
  ],
)

// Contacts of an engagement beyond its primary contact (engagements.contact_id).
// portal_access = true lets that contact open the client portal by magic link.
export const engagementContacts = pgTable(
  'engagement_contacts',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    engagementId: text('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    // Free-form: e.g. direccion, facturacion, tecnico.
    role: varchar('role', { length: 50 }),
    portalAccess: boolean('portal_access').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('engagement_contacts_engagement_contact_uniq').on(
      table.engagementId,
      table.contactId,
    ),
    index('engagement_contacts_contact_id_idx').on(table.contactId),
  ],
)

export type EngagementItem = typeof engagementItems.$inferSelect
export type NewEngagementItem = typeof engagementItems.$inferInsert
export type EngagementContact = typeof engagementContacts.$inferSelect
export type NewEngagementContact = typeof engagementContacts.$inferInsert

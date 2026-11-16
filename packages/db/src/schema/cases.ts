import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { contacts } from './contacts'
import { users } from './users'
import { createId } from './utils'

// A request from a contact that carries a deadline. Default due dates per
// type live in `packages/services/src/cases/case-deadlines.ts`.
export const CASE_TYPES = ['support', 'refund', 'data_rights', 'invoice_correction'] as const
export type CaseType = (typeof CASE_TYPES)[number]

export const CASE_STATUSES = ['open', 'in_progress', 'resolved'] as const
export type CaseStatus = (typeof CASE_STATUSES)[number]

export const cases = pgTable(
  'cases',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    type: varchar('type', { length: 30 }).$type<CaseType>().notNull(),
    summary: text('summary').notNull(),
    status: varchar('status', { length: 20 }).$type<CaseStatus>().notNull().default('open'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    ownerId: text('owner_id').references(() => users.id),
    // Set when the case is resolved; cleared if it is reopened.
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('cases_contact_id_idx').on(table.contactId),
    index('cases_status_due_at_idx').on(table.status, table.dueAt),
    index('cases_owner_id_idx').on(table.ownerId),
    check(
      'cases_type_check',
      sql`${table.type} in ('support', 'refund', 'data_rights', 'invoice_correction')`,
    ),
    check('cases_status_check', sql`${table.status} in ('open', 'in_progress', 'resolved')`),
    check(
      'cases_resolved_at_check',
      sql`(${table.status} = 'resolved') = (${table.resolvedAt} is not null)`,
    ),
  ],
)

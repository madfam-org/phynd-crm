import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { createId } from './utils'

// How the person wants to be addressed in Spanish. NULL = not asked yet;
// readers then use 'usted'. Per person, never per company.
export const SPANISH_FORMALITIES = ['tu', 'usted'] as const
export type SpanishFormality = (typeof SPANISH_FORMALITIES)[number]

export const contacts = pgTable(
  'contacts',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    externalJanuaId: varchar('external_janua_id', { length: 255 }),
    // Coforma federation: when this contact also exists as a CAB member in
    // Coforma Studio, both IDs are filled. Set by the inbound webhook from
    // Coforma (`member.joined`/`member.exited`); cleared on `member.exited`
    // is operator-decided. Indexed (non-unique) for cross-system lookups.
    coformaCabMembershipId: varchar('coforma_cab_membership_id', { length: 255 }),
    coformaCabId: varchar('coforma_cab_id', { length: 255 }),
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    company: varchar('company', { length: 255 }),
    // Name the person wants to be called by (portal greeting, hand-written comms).
    preferredName: varchar('preferred_name', { length: 255 }),
    spanishFormality: varchar('spanish_formality', { length: 8 }).$type<SpanishFormality>(),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    ownerId: text('owner_id').references(() => users.id),
    marketingConsent: boolean('marketing_consent').notNull().default(false),
    consentedAt: timestamp('consented_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('contacts_external_janua_id_uniq').on(table.externalJanuaId),
    index('contacts_coforma_cab_membership_id_idx').on(table.coformaCabMembershipId),
    check(
      'contacts_spanish_formality_check',
      sql`${table.spanishFormality} is null or ${table.spanishFormality} in ('tu', 'usted')`,
    ),
  ],
)

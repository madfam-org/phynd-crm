import { boolean, index, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'
import { createId } from './utils'

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
  ],
)

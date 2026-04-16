import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { contacts } from './contacts'
import { conversions } from './conversions'
import { leads } from './leads'
import { createId } from './utils'

export const referralCodes = pgTable(
  'referral_codes',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    code: varchar('code', { length: 20 }).notNull().unique(),
    ownerJanuaId: varchar('owner_janua_id', { length: 255 }).notNull(),
    ownerEmail: varchar('owner_email', { length: 255 }),
    ownerName: varchar('owner_name', { length: 255 }),
    sourceProduct: varchar('source_product', { length: 50 }).notNull(),
    maxUses: integer('max_uses'),
    currentUses: integer('current_uses').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('referral_codes_owner_idx').on(table.ownerJanuaId)],
)

export const referrals = pgTable(
  'referrals',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    referralCodeId: text('referral_code_id')
      .notNull()
      .references(() => referralCodes.id),
    referrerJanuaId: varchar('referrer_janua_id', { length: 255 }).notNull(),
    referredJanuaId: varchar('referred_janua_id', { length: 255 }),
    referredEmail: varchar('referred_email', { length: 255 }),
    referredName: varchar('referred_name', { length: 255 }),
    sourceProduct: varchar('source_product', { length: 50 }).notNull(),
    targetProduct: varchar('target_product', { length: 50 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    planId: varchar('plan_id', { length: 100 }),
    revenueCents: integer('revenue_cents'),
    contactId: text('contact_id').references(() => contacts.id),
    leadId: text('lead_id').references(() => leads.id),
    conversionId: text('conversion_id').references(() => conversions.id),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('referrals_code_id_idx').on(table.referralCodeId),
    index('referrals_referrer_idx').on(table.referrerJanuaId),
    index('referrals_referred_idx').on(table.referredJanuaId),
    index('referrals_status_idx').on(table.status),
    uniqueIndex('referrals_code_email_uniq')
      .on(table.referralCodeId, table.referredEmail)
      .where(sql`referred_email IS NOT NULL`),
  ],
)

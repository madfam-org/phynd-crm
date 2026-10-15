import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { contacts } from './contacts'
import { engagements } from './engagements'
import { orders } from './orders'
import { quotes } from './quotes'
import { users } from './users'
import { createId } from './utils'

export const PAYMENT_METHODS = ['spei_transfer', 'card', 'cash', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

// recorded -> verified -> voided (and recorded -> voided). Rows are never deleted.
export const PAYMENT_EVIDENCE_STATUSES = ['recorded', 'verified', 'voided'] as const
export type PaymentEvidenceStatus = (typeof PAYMENT_EVIDENCE_STATUSES)[number]

export const PAYMENT_EVIDENCE_SOURCES = ['manual', 'extracted'] as const
export type PaymentEvidenceSource = (typeof PAYMENT_EVIDENCE_SOURCES)[number]

// Ten or more digits, optionally separated by single spaces or hyphens: a bank
// account, CLABE or card number. Free-text columns refuse it (the service
// refuses it first, with a clearer message).
const NO_LONG_DIGIT_RUN = "!~ '[0-9]([ -]?[0-9]){9,}'"

// Structured record of a client payment and its private evidence file (a bank
// receipt image or PDF in R2). Account numbers are never stored beyond their
// last four digits.
export const paymentEvidence = pgTable(
  'payment_evidence',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    engagementId: text('engagement_id')
      .notNull()
      .references(() => engagements.id),
    quoteId: text('quote_id').references(() => quotes.id),
    orderId: text('order_id').references(() => orders.id),
    // The payer; defaults to the engagement's primary contact.
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    method: varchar('method', { length: 20 }).$type<PaymentMethod>().notNull(),
    bankName: varchar('bank_name', { length: 100 }),
    operationType: varchar('operation_type', { length: 100 }),
    folio: varchar('folio', { length: 64 }),
    // SPEI clave de rastreo.
    trackingKey: varchar('tracking_key', { length: 64 }),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('MXN'),
    // The payer's "concepto".
    reference: varchar('reference', { length: 255 }),
    originAccountLast4: varchar('origin_account_last4', { length: 4 }),
    destinationAccountLast4: varchar('destination_account_last4', { length: 4 }),
    beneficiaryName: varchar('beneficiary_name', { length: 255 }),
    // Staff-only.
    notes: text('notes'),
    status: varchar('status', { length: 10 })
      .$type<PaymentEvidenceStatus>()
      .notNull()
      .default('recorded'),
    verifiedByUserId: text('verified_by_user_id').references(() => users.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    voidedByUserId: text('voided_by_user_id').references(() => users.id),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    source: varchar('source', { length: 10 })
      .$type<PaymentEvidenceSource>()
      .notNull()
      .default('manual'),
    // 0..1, set when an extractor prefilled the fields.
    extractionConfidence: numeric('extraction_confidence', { precision: 4, scale: 3 }),
    // Content-addressed R2 key (payment-evidence/<sha256>.<ext>); never public.
    evidenceStorageKey: varchar('evidence_storage_key', { length: 255 }),
    evidenceMime: varchar('evidence_mime', { length: 50 }),
    evidenceSha256: varchar('evidence_sha256', { length: 64 }),
    clientVisible: boolean('client_visible').notNull().default(true),
    // Stable id from the operator import; unique per engagement.
    externalKey: varchar('external_key', { length: 200 }),
    // Actor id (CRM user id, else the caller's principal).
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('payment_evidence_engagement_id_idx').on(table.engagementId),
    index('payment_evidence_quote_id_idx').on(table.quoteId),
    index('payment_evidence_order_id_idx').on(table.orderId),
    index('payment_evidence_client_visible_idx').on(table.engagementId, table.clientVisible),
    uniqueIndex('payment_evidence_external_key_uniq').on(table.engagementId, table.externalKey),
    check(
      'payment_evidence_method_check',
      sql`${table.method} in ('spei_transfer', 'card', 'cash', 'other')`,
    ),
    check(
      'payment_evidence_status_check',
      sql`${table.status} in ('recorded', 'verified', 'voided')`,
    ),
    check('payment_evidence_source_check', sql`${table.source} in ('manual', 'extracted')`),
    check('payment_evidence_amount_check', sql`${table.amount} > 0`),
    check('payment_evidence_currency_check', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      'payment_evidence_origin_last4_check',
      sql`${table.originAccountLast4} is null or ${table.originAccountLast4} ~ '^[0-9]{4}$'`,
    ),
    check(
      'payment_evidence_destination_last4_check',
      sql`${table.destinationAccountLast4} is null or ${table.destinationAccountLast4} ~ '^[0-9]{4}$'`,
    ),
    check(
      'payment_evidence_sha256_check',
      sql`${table.evidenceSha256} is null or ${table.evidenceSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'payment_evidence_confidence_check',
      sql`${table.extractionConfidence} is null or (${table.extractionConfidence} >= 0 and ${table.extractionConfidence} <= 1)`,
    ),
    check(
      'payment_evidence_free_text_check',
      sql.raw(
        ['reference', 'notes', 'beneficiary_name', 'bank_name', 'operation_type']
          .map((c) => `coalesce("${c}", '') ${NO_LONG_DIGIT_RUN}`)
          .join(' and '),
      ),
    ),
  ],
)

export type PaymentEvidence = typeof paymentEvidence.$inferSelect
export type NewPaymentEvidence = typeof paymentEvidence.$inferInsert

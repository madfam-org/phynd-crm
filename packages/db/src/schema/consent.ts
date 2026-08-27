import { index, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'
import { contacts } from './contacts'
import { createId } from './utils'

// ---------------------------------------------------------------------------
// LFPDPPP-grade marketing consent (Art. 7) — channel-scoped consent records.
//
// One current-state row per (identifier, channel). `identifier` is a
// lowercase email address (channel=email) or E.164 phone (channel=sms /
// whatsapp). Every transition is appended to `consent_audit` so the full
// evidence trail survives status changes.
// ---------------------------------------------------------------------------

export const consentRecords = pgTable(
  'consent_records',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    // Lowercase email or E.164 phone — the cross-product identity anchor.
    // Consent may be captured on dhanam/karafiel/tezca before a CRM contact
    // exists, so this is the primary key of the model; contactId is a link.
    identifier: varchar('identifier', { length: 255 }).notNull(),
    // email | sms | whatsapp
    channel: varchar('channel', { length: 16 }).notNull(),
    // granted | revoked | pending_double_opt_in
    status: varchar('status', { length: 32 }).notNull().default('pending_double_opt_in'),
    // Where the latest transition came from (e.g. dhanam_signup_form,
    // karafiel_settings, tezca_newsletter, resend_webhook, manual, import)
    source: varchar('source', { length: 128 }).notNull(),
    // Free-text evidence for the latest transition (consent copy shown,
    // form snapshot, requester IP, ticket reference…)
    evidence: text('evidence'),
    contactId: text('contact_id').references(() => contacts.id),
    // Double opt-in: only the SHA-256 hash of the confirmation token is
    // stored; the raw token goes out in the confirmation email/URL.
    doubleOptInTokenHash: varchar('double_opt_in_token_hash', { length: 64 }),
    doubleOptInExpiresAt: timestamp('double_opt_in_expires_at', { withTimezone: true }),
    grantedAt: timestamp('granted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('consent_records_identifier_channel_uniq').on(table.identifier, table.channel),
    index('consent_records_contact_id_idx').on(table.contactId),
    index('consent_records_token_hash_idx').on(table.doubleOptInTokenHash),
  ],
)

export const consentAudit = pgTable(
  'consent_audit',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    consentRecordId: text('consent_record_id')
      .notNull()
      .references(() => consentRecords.id),
    // grant | revoke | request_double_opt_in | confirm_double_opt_in
    action: varchar('action', { length: 32 }).notNull(),
    previousStatus: varchar('previous_status', { length: 32 }),
    newStatus: varchar('new_status', { length: 32 }).notNull(),
    source: varchar('source', { length: 128 }).notNull(),
    evidence: text('evidence'),
    // Who performed the transition: service:dhanam, service:resend-webhook,
    // a staff userId, or the data subject ("subject" for self-service links)
    actor: varchar('actor', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('consent_audit_record_id_idx').on(table.consentRecordId)],
)

// ---------------------------------------------------------------------------
// Cross-product suppression list. Suppression ALWAYS wins over any consent —
// a granted consent record never overrides a suppression entry. channel='all'
// suppresses every channel for the identifier.
// ---------------------------------------------------------------------------

export const suppressionEntries = pgTable(
  'suppression_entries',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    // all | email | sms | whatsapp
    channel: varchar('channel', { length: 16 }).notNull().default('all'),
    // complaint | hard_bounce | unsubscribe | manual | legal_request
    reason: varchar('reason', { length: 64 }).notNull(),
    // Which product/system added the entry (dhanam, karafiel, tezca,
    // resend_webhook, phynd_crm)
    source: varchar('source', { length: 128 }).notNull(),
    evidence: text('evidence'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('suppression_entries_identifier_channel_uniq').on(table.identifier, table.channel),
    index('suppression_entries_identifier_idx').on(table.identifier),
  ],
)

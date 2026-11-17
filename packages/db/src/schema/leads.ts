import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { contacts } from './contacts'
import { pipelineStages, pipelines } from './pipelines'
import { users } from './users'
import { createId } from './utils'

/**
 * Where a lead came from, as reported by the system that captured it: campaign
 * parameters, the page it arrived on and, for a scheduled meeting, the booking.
 * Short string values only; `LeadsService.create` stores it already cleaned
 * (`sanitizeLeadAttribution` in `@phynd/services`).
 */
export type LeadAttribution = {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  referrer?: string
  landing_page?: string
  tenant?: string
  quote_id?: string
  quote_number?: string
  quote_total?: string
  quote_currency?: string
  booking?: {
    id?: string
    starts_at?: string
    event_type_name?: string
    host_name?: string
    timezone?: string
  }
  /** The sender's lead kind (Avala: `INDIVIDUAL` | `COMPANY`). */
  lead_type?: string
  /** Competency standard the lead asked about (Avala). */
  ec_code?: string
  /** What the lead asked for (Avala: `sales-request`, `request-access`, `waitlist`). */
  intent?: string
  /** Availability of what was asked for, as the sender reported it. */
  availability_status?: string
  /** Topics the lead picked on the sender's form. */
  interests?: string[]
}

export const leads = pgTable(
  'leads',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    contactId: text('contact_id').references(() => contacts.id),
    externalJanuaId: varchar('external_janua_id', { length: 255 }),
    source: varchar('source', { length: 100 }),
    attribution: jsonb('attribution').$type<LeadAttribution>(),
    status: varchar('status', { length: 20 }).notNull().default('new'),
    score: integer('score'),
    /**
     * A | B | C, derived from `score` when it is computed (lead-qualification.ts):
     * A >= 7, B 4-6, C <= 3; a `waitlist` lead is always C. Null until scored.
     */
    tier: varchar('tier', { length: 1 }),
    /**
     * Synthetic or test traffic (smoke tests, probes, reserved addresses), set at
     * intake by rule. Left out of lead lists and metrics by default.
     */
    isTest: boolean('is_test').notNull().default(false),
    unsubscribed: boolean('unsubscribed').notNull().default(false),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    pipelineId: text('pipeline_id')
      .notNull()
      .references(() => pipelines.id),
    stageId: text('stage_id')
      .notNull()
      .references(() => pipelineStages.id),
    ownerId: text('owner_id').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('leads_contact_id_idx').on(table.contactId),
    index('leads_pipeline_stage_idx').on(table.pipelineId, table.stageId),
    index('leads_owner_tier_idx').on(table.ownerId, table.tier),
  ],
)

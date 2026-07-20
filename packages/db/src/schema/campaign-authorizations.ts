import { index, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { campaigns } from './campaigns'
import { createId } from './utils'

// ---------------------------------------------------------------------------
// Owner authorization ledger for campaign sends (G4 human gate).
//
// One row per authorization *request*. The `snapshot` column freezes exactly
// what was put in front of the authorizer: campaign identity, sender,
// schedule, audience definition, every copy variant, and the consent-coverage
// numbers observed at snapshot time. `payloadHash` is a SHA-256 over the
// authorization-relevant subset of that snapshot (content, audience
// definition, schedule, sender — NOT the live counts, which legitimately
// drift as double-opt-ins confirm).
//
// The send path (`attemptTulanaSend`) is hard-gated on an `authorized` row
// whose payloadHash still matches the campaign's current payload — editing
// copy, schedule, audience definition, or sender after authorization
// invalidates it (fail closed). Decisions never overwrite the snapshot;
// only decision fields are written on decide.
//
// status: pending | authorized | rejected | superseded
// ---------------------------------------------------------------------------

export const campaignAuthorizations = pgTable(
  'campaign_authorizations',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    // SHA-256 hex over the canonical authorized-payload JSON (stable key order).
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    // Immutable full snapshot shown to the authorizer (authorized payload +
    // informational context such as consent coverage at capture time).
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    // Who generated the request (staff userId, or service:* principal).
    requestedBy: varchar('requested_by', { length: 255 }).notNull(),
    // Human identity that made the decision. For decisions relayed through a
    // service surface (Selva), this is the operator identity the service
    // asserted; decidedVia records the relay.
    decidedBy: varchar('decided_by', { length: 255 }),
    // web | selva — which surface carried the decision.
    decidedVia: varchar('decided_via', { length: 32 }),
    // Required when rejecting; optional context when authorizing.
    decisionNote: text('decision_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('campaign_authorizations_campaign_id_idx').on(table.campaignId),
    index('campaign_authorizations_status_idx').on(table.status),
  ],
)

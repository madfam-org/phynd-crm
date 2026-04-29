import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { contacts } from './contacts'
import { pipelineStages, pipelines } from './pipelines'
import { users } from './users'
import { createId } from './utils'

export const grantOpportunities = pgTable(
  'grant_opportunities',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    fortunaGrantId: varchar('fortuna_grant_id', { length: 255 }),
    title: varchar('title', { length: 500 }).notNull(),
    grantingBody: varchar('granting_body', { length: 255 }),
    category: varchar('category', { length: 100 }),
    fundingType: varchar('funding_type', { length: 50 }),
    minAmount: numeric('min_amount', { precision: 18, scale: 2 }),
    maxAmount: numeric('max_amount', { precision: 18, scale: 2 }),
    currency: varchar('currency', { length: 5 }).notNull().default('MXN'),
    sourceUrl: varchar('source_url', { length: 2048 }),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    relevanceScore: numeric('relevance_score', { precision: 5, scale: 3 }),
    requirementsSummary: text('requirements_summary'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('grant_opportunities_fortuna_grant_id_uniq').on(table.fortunaGrantId),
    index('grant_opportunities_closes_at_idx').on(table.closesAt),
  ],
)

export const grantApplications = pgTable(
  'grant_applications',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    grantOpportunityId: text('grant_opportunity_id')
      .notNull()
      .references(() => grantOpportunities.id),
    contactId: text('contact_id').references(() => contacts.id),
    pipelineId: text('pipeline_id')
      .notNull()
      .references(() => pipelines.id),
    stageId: text('stage_id')
      .notNull()
      .references(() => pipelineStages.id),
    status: varchar('status', { length: 30 }).notNull().default('draft'),
    hitlApprovedBy: text('hitl_approved_by'),
    hitlApprovedAt: timestamp('hitl_approved_at', { withTimezone: true }),
    hitlNotes: text('hitl_notes'),
    requestedAmount: numeric('requested_amount', { precision: 18, scale: 2 }),
    awardedAmount: numeric('awarded_amount', { precision: 18, scale: 2 }),
    applicationDraft: jsonb('application_draft').notNull().default({}),
    complianceChecks: jsonb('compliance_checks').notNull().default({}),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    ownerId: text('owner_id').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('grant_applications_grant_opportunity_id_idx').on(table.grantOpportunityId),
    index('grant_applications_status_idx').on(table.status),
    index('grant_applications_pipeline_stage_idx').on(table.pipelineId, table.stageId),
  ],
)

export const grantSignalAudit = pgTable(
  'grant_signal_audit',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    grantOpportunityId: text('grant_opportunity_id')
      .notNull()
      .references(() => grantOpportunities.id),
    grantApplicationId: text('grant_application_id').references(() => grantApplications.id),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    actor: text('actor').notNull(),
    details: jsonb('details').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('grant_signal_audit_grant_opportunity_id_idx').on(table.grantOpportunityId),
    index('grant_signal_audit_grant_application_id_idx').on(table.grantApplicationId),
  ],
)

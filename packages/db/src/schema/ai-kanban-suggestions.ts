import { index, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { pipelineStages } from './pipelines'
import { createId } from './utils'

export const aiKanbanSuggestions = pgTable(
  'ai_kanban_suggestions',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    entityType: varchar('entity_type', { length: 20 }).notNull(),
    entityId: text('entity_id').notNull(),
    suggestionType: varchar('suggestion_type', { length: 40 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    rationale: text('rationale'),
    proposedStageId: text('proposed_stage_id').references(() => pipelineStages.id),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    source: varchar('source', { length: 64 }).notNull().default('service:selva'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_kanban_suggestions_entity_idx').on(table.entityType, table.entityId),
    index('ai_kanban_suggestions_status_idx').on(table.status),
    index('ai_kanban_suggestions_proposed_stage_idx').on(table.proposedStageId),
  ],
)

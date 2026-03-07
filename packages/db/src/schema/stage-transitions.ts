import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { pipelineStages } from './pipelines'
import { createId } from './utils'

export const stageTransitions = pgTable('stage_transitions', {
  id: text('id').primaryKey().$defaultFn(createId),
  entityType: varchar('entity_type', { length: 20 }).notNull(),
  entityId: text('entity_id').notNull(),
  fromStageId: text('from_stage_id').references(() => pipelineStages.id),
  toStageId: text('to_stage_id')
    .notNull()
    .references(() => pipelineStages.id),
  transitionedBy: text('transitioned_by'),
  transitionedAt: timestamp('transitioned_at', { withTimezone: true }).notNull().defaultNow(),
})

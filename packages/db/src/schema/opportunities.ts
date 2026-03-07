import { integer, numeric, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { contacts } from './contacts'
import { pipelineStages, pipelines } from './pipelines'
import { createId } from './utils'

export const opportunities = pgTable('opportunities', {
  id: text('id').primaryKey().$defaultFn(createId),
  name: varchar('name', { length: 255 }).notNull(),
  contactId: text('contact_id').references(() => contacts.id),
  pipelineId: text('pipeline_id').notNull().references(() => pipelines.id),
  stageId: text('stage_id').notNull().references(() => pipelineStages.id),
  value: numeric('value', { precision: 12, scale: 2 }),
  probability: integer('probability'),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  expectedCloseDate: timestamp('expected_close_date', { withTimezone: true }),
  ownerId: text('owner_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
})

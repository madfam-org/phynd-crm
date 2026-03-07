import { integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { contacts } from './contacts'
import { pipelineStages, pipelines } from './pipelines'
import { createId } from './utils'

export const leads = pgTable('leads', {
  id: text('id').primaryKey().$defaultFn(createId),
  contactId: text('contact_id').references(() => contacts.id),
  externalJanuaId: varchar('external_janua_id', { length: 255 }),
  source: varchar('source', { length: 100 }),
  status: varchar('status', { length: 20 }).notNull().default('new'),
  score: integer('score'),
  pipelineId: text('pipeline_id')
    .notNull()
    .references(() => pipelines.id),
  stageId: text('stage_id')
    .notNull()
    .references(() => pipelineStages.id),
  ownerId: text('owner_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

import { boolean, index, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { contacts } from './contacts'
import { pipelineStages, pipelines } from './pipelines'
import { users } from './users'
import { createId } from './utils'

export const leads = pgTable(
  'leads',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    contactId: text('contact_id').references(() => contacts.id),
    externalJanuaId: varchar('external_janua_id', { length: 255 }),
    source: varchar('source', { length: 100 }),
    status: varchar('status', { length: 20 }).notNull().default('new'),
    score: integer('score'),
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
  ],
)

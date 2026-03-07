import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { createId } from './utils'

export const notes = pgTable('notes', {
  id: text('id').primaryKey().$defaultFn(createId),
  content: text('content').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  authorId: text('author_id').notNull(),
  isPinned: boolean('is_pinned').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

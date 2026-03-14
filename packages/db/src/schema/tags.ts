import { index, pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { createId } from './utils'

export const tags = pgTable('tags', {
  id: text('id').primaryKey().$defaultFn(createId),
  name: varchar('name', { length: 100 }).notNull().unique(),
  color: varchar('color', { length: 7 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const taggables = pgTable(
  'taggables',
  {
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    entityType: varchar('entity_type', { length: 20 }).notNull(),
    entityId: text('entity_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tagId, table.entityType, table.entityId] }),
    index('taggables_entity_idx').on(table.entityType, table.entityId),
  ],
)

import { integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { createId } from './utils'
import { visitorSessions } from './visitor-sessions'

export const visitorPageViews = pgTable('visitor_page_views', {
  id: text('id').primaryKey().$defaultFn(createId),
  sessionId: text('session_id')
    .notNull()
    .references(() => visitorSessions.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  title: varchar('title', { length: 500 }),
  duration: integer('duration'),
  viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
})

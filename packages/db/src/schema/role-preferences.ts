import { jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { createId } from './utils'

export const roleViewPreferences = pgTable('role_view_preferences', {
  id: text('id').primaryKey().$defaultFn(createId),
  role: varchar('role', { length: 50 }).notNull().unique(),
  panelOrder: jsonb('panel_order').$type<string[]>().notNull().default([]),
  defaultTab: varchar('default_tab', { length: 100 }),
  visibleColumns: jsonb('visible_columns').$type<Record<string, string[]>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
})

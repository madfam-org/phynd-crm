import { boolean, integer, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { createId } from './utils'

export const leadScoringRules = pgTable('lead_scoring_rules', {
  id: text('id').primaryKey().$defaultFn(createId),
  name: varchar('name', { length: 255 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  condition: jsonb('condition').notNull(),
  points: integer('points').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const leadScores = pgTable('lead_scores', {
  id: text('id').primaryKey().$defaultFn(createId),
  leadId: text('lead_id').notNull(),
  totalScore: integer('total_score').notNull().default(0),
  demographicScore: integer('demographic_score').notNull().default(0),
  behaviorScore: integer('behavior_score').notNull().default(0),
  engagementScore: integer('engagement_score').notNull().default(0),
  breakdown: jsonb('breakdown'),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

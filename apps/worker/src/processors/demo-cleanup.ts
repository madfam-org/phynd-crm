import { getDb } from '@phynd/db'
import {
  activities,
  campaigns,
  contacts,
  conversions,
  externalReferences,
  leadScoringRules,
  leads,
  notes,
  notifications,
  offers,
  opportunities,
  orders,
  pipelineStages,
  pipelines,
  quotes,
  stageTransitions,
  taggables,
  tags,
  users,
  visitorPageViews,
  visitorSessions,
} from '@phynd/db/schema'
import { createLogger } from '@phynd/logging'
import type { Job } from 'bullmq'
import { and, like, lt, sql } from 'drizzle-orm'

const logger = createLogger('worker:demo-cleanup')

const DEMO_PREFIX = 'demo-%'
const MAX_AGE_HOURS = 4

export async function processDemoCleanup(_job: Job): Promise<void> {
  logger.info('Starting demo tenant cleanup')

  const db = getDb()
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000)

  // Find expired demo users
  const expiredUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(like(users.id, DEMO_PREFIX), lt(users.createdAt, cutoff)))

  if (expiredUsers.length === 0) {
    logger.info('No expired demo tenants found')
    return
  }

  const expiredIds = expiredUsers.map((u) => u.id)
  logger.info({ count: expiredIds.length }, `Found ${expiredIds.length} expired demo tenants`)

  let cleaned = 0
  for (const userId of expiredIds) {
    try {
      await db.transaction(async (tx) => {
        const prefix = `${userId}%`

        // Phase 1: entities with no dependents among demo data
        await tx.delete(taggables).where(like(taggables.tagId, prefix))
        await tx.delete(tags).where(like(tags.id, prefix))
        await tx.delete(notes).where(like(notes.id, prefix))
        await tx.delete(notifications).where(like(notifications.id, prefix))
        await tx.delete(activities).where(like(activities.id, prefix))

        // Phase 2: entities referencing other entities being deleted
        await tx.delete(conversions).where(like(conversions.id, prefix))
        await tx.delete(visitorPageViews).where(like(visitorPageViews.id, prefix))
        await tx.delete(visitorSessions).where(like(visitorSessions.id, prefix))
        await tx.delete(stageTransitions).where(like(stageTransitions.id, prefix))
        await tx.delete(externalReferences).where(like(externalReferences.id, prefix))
        await tx.delete(leadScoringRules).where(like(leadScoringRules.id, prefix))

        // Phase 3: core entities
        await tx.delete(orders).where(like(orders.id, prefix))
        await tx.delete(quotes).where(like(quotes.id, prefix))
        await tx.delete(opportunities).where(like(opportunities.id, prefix))
        await tx.delete(leads).where(like(leads.id, prefix))
        await tx.delete(contacts).where(like(contacts.id, prefix))

        // Phase 4: campaigns/offers (campaigns FK to offers)
        await tx.delete(campaigns).where(like(campaigns.id, prefix))
        await tx.delete(offers).where(like(offers.id, prefix))

        // Phase 5: pipeline structure + user
        await tx.delete(pipelineStages).where(like(pipelineStages.id, prefix))
        await tx.delete(pipelines).where(like(pipelines.id, prefix))
        await tx.delete(users).where(sql`${users.id} = ${userId}`)
      })
      cleaned++
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), userId },
        `Failed to clean demo tenant ${userId}`,
      )
    }
  }

  logger.info(
    { cleaned, total: expiredIds.length },
    `Demo cleanup complete: ${cleaned}/${expiredIds.length} tenants removed`,
  )
}

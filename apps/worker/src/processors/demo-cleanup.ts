import { getDb } from '@phyne/db'
import {
  activities,
  contacts,
  leads,
  notes,
  notifications,
  opportunities,
  orders,
  pipelineStages,
  pipelines,
  quotes,
  taggables,
  tags,
  users,
} from '@phyne/db/schema'
import { createLogger } from '@phyne/logging'
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
        // Delete in reverse dependency order
        const prefix = `${userId}%`

        await tx.delete(taggables).where(like(taggables.tagId, prefix))
        await tx.delete(tags).where(like(tags.id, prefix))
        await tx.delete(notes).where(like(notes.id, prefix))
        await tx.delete(notifications).where(like(notifications.id, prefix))
        await tx.delete(activities).where(like(activities.id, prefix))
        await tx.delete(orders).where(like(orders.id, prefix))
        await tx.delete(quotes).where(like(quotes.id, prefix))
        await tx.delete(opportunities).where(like(opportunities.id, prefix))
        await tx.delete(leads).where(like(leads.id, prefix))
        await tx.delete(contacts).where(like(contacts.id, prefix))
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

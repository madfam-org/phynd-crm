import { getDb } from '@phyne/db'
import { activities, notifications } from '@phyne/db/schema'
import { createLogger } from '@phyne/logging'
import type { Job } from 'bullmq'
import { and, eq, gt, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm'

const logger = createLogger('worker:task-reminders')

export async function processTaskReminders(_job: Job): Promise<void> {
  logger.info('Scanning for activities due within 24 hours')

  const db = getDb()
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  // Find pending activities with dueAt within next 24h and an assigned owner
  const dueActivities = await db
    .select({
      id: activities.id,
      ownerId: activities.ownerId,
      title: activities.title,
    })
    .from(activities)
    .where(
      and(
        eq(activities.status, 'pending'),
        isNotNull(activities.ownerId),
        gt(activities.dueAt, now),
        lte(activities.dueAt, in24h),
      ),
    )

  if (dueActivities.length === 0) {
    logger.info('No activities due within 24 hours')
    return
  }

  logger.info({ count: dueActivities.length }, `Found ${dueActivities.length} activities due soon`)

  let created = 0
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  for (const activity of dueActivities) {
    // Check for duplicate notification in last 24h
    const [existing] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.entityType, 'activity'),
          eq(notifications.entityId, activity.id),
          eq(notifications.type, 'task_reminder'),
          gte(notifications.createdAt, cutoff),
        ),
      )
      .limit(1)

    if (existing) {
      continue
    }

    await db.insert(notifications).values({
      entityId: activity.id,
      entityType: 'activity',
      title: `Task due soon: ${activity.title}`,
      type: 'task_reminder',
      // biome-ignore lint/style/noNonNullAssertion: filtered by isNotNull above
      userId: activity.ownerId!,
    })
    created++
  }

  logger.info(
    { created, scanned: dueActivities.length },
    `Created ${created} task reminder notifications`,
  )
}

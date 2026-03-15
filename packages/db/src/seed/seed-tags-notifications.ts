import { notifications } from '../schema/notifications'
import { taggables, tags } from '../schema/tags'
import type { Db, SeedIds } from './types'

export async function seedTagsAndNotifications(db: Db, ids: SeedIds) {
  const { adminId, contacts: c, leads: l, opps } = ids

  const sampleTags = await db
    .insert(tags)
    .values([
      { name: 'VIP', color: '#8b5cf6' },
      { name: 'Enterprise', color: '#3b82f6' },
      { name: 'Hot Lead', color: '#ef4444' },
    ])
    .onConflictDoNothing()
    .returning()

  if (sampleTags.length > 0) {
    await db
      .insert(taggables)
      .values([
        {
          tagId: sampleTags[0]?.id ?? '',
          entityType: 'contact',
          entityId: c[0]?.id ?? '',
        },
        {
          tagId: sampleTags[1]?.id ?? '',
          entityType: 'contact',
          entityId: c[0]?.id ?? '',
        },
        {
          tagId: sampleTags[2]?.id ?? '',
          entityType: 'lead',
          entityId: l[0]?.id ?? '',
        },
      ])
      .onConflictDoNothing()
  }

  await db
    .insert(notifications)
    .values([
      {
        userId: adminId,
        type: 'owner_assignment',
        title: 'New lead assigned to you',
        message: 'You have been assigned lead: website',
        entityType: 'lead',
        entityId: l[0]?.id ?? '',
        isRead: false,
      },
      {
        userId: adminId,
        type: 'owner_assignment',
        title: 'New opportunity assigned to you',
        message: 'You have been assigned opportunity: TechCorp Enterprise Deal',
        entityType: 'opportunity',
        entityId: opps[0]?.id ?? '',
        isRead: true,
        readAt: new Date(),
      },
    ])
    .onConflictDoNothing()
}

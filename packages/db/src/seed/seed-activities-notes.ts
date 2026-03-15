import { activities } from '../schema/activities'
import { notes } from '../schema/notes'
import type { Db, SeedIds } from './types'

export async function seedActivitiesAndNotes(db: Db, ids: SeedIds) {
  const { adminId, contacts: c, leads: l, opps } = ids

  await db.insert(activities).values([
    {
      type: 'call',
      title: 'Discovery call with Alice',
      description: 'Initial discovery call to discuss TechCorp requirements',
      entityType: 'contact',
      entityId: c[0]?.id ?? '',
      ownerId: adminId,
      status: 'completed',
      completedAt: new Date('2025-01-15'),
    },
    {
      type: 'email',
      title: 'Send proposal to Bob',
      description: 'Follow up with platform license proposal',
      entityType: 'lead',
      entityId: l[1]?.id ?? '',
      ownerId: adminId,
      status: 'pending',
    },
    {
      type: 'meeting',
      title: 'Contract negotiation - DesignLab',
      entityType: 'opportunity',
      entityId: opps[1]?.id ?? '',
      ownerId: adminId,
      status: 'pending',
      dueAt: new Date(Date.now() + 3 * 86400000),
    },
    {
      type: 'task',
      title: 'Prepare demo environment',
      description: 'Set up sandbox for InnovaTech demo',
      entityType: 'lead',
      entityId: l[2]?.id ?? '',
      ownerId: adminId,
      status: 'pending',
      dueAt: new Date(Date.now() + 7 * 86400000),
    },
  ])

  await db.insert(notes).values([
    {
      content:
        'Alice mentioned they are evaluating 3 competing platforms. Key differentiator is federation capability.',
      entityType: 'contact',
      entityId: c[0]?.id ?? '',
      authorId: adminId,
    },
    {
      content: 'Budget approved for Q2. Decision expected by end of March.',
      entityType: 'opportunity',
      entityId: opps[0]?.id ?? '',
      authorId: adminId,
      isPinned: true,
    },
  ])
}

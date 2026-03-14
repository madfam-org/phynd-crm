import { activities, notes, stageTransitions } from '@phyne/db/schema'
import type { EntityType } from '@phyne/types/crm'
import { and, desc, eq } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export interface TimelineEntry {
  id: string
  type: 'activity' | 'stage_move' | 'note'
  timestamp: Date
  title: string
  description: string | null
  metadata: Record<string, unknown>
}

export class TimelineService {
  constructor(private readonly ctx: ServiceContext) {}

  async getTimeline(entityType: EntityType, entityId: string): Promise<TimelineEntry[]> {
    const [activityRows, transitionRows, noteRows] = await Promise.all([
      this.ctx.db
        .select()
        .from(activities)
        .where(and(eq(activities.entityType, entityType), eq(activities.entityId, entityId)))
        .orderBy(desc(activities.createdAt)),
      this.ctx.db
        .select()
        .from(stageTransitions)
        .where(
          and(eq(stageTransitions.entityType, entityType), eq(stageTransitions.entityId, entityId)),
        )
        .orderBy(desc(stageTransitions.transitionedAt)),
      this.ctx.db
        .select()
        .from(notes)
        .where(and(eq(notes.entityType, entityType), eq(notes.entityId, entityId)))
        .orderBy(desc(notes.createdAt)),
    ])

    const entries: TimelineEntry[] = []

    for (const a of activityRows) {
      entries.push({
        id: a.id,
        type: 'activity',
        timestamp: a.createdAt,
        title: a.title,
        description: a.description,
        metadata: {
          activityType: a.type,
          status: a.status,
          ownerId: a.ownerId,
          completedAt: a.completedAt,
        },
      })
    }

    for (const t of transitionRows) {
      entries.push({
        id: t.id,
        type: 'stage_move',
        timestamp: t.transitionedAt,
        title: 'Stage changed',
        description: null,
        metadata: {
          fromStageId: t.fromStageId,
          toStageId: t.toStageId,
          transitionedBy: t.transitionedBy,
        },
      })
    }

    for (const n of noteRows) {
      entries.push({
        id: n.id,
        type: 'note',
        timestamp: n.createdAt,
        title: 'Note added',
        description: n.content,
        metadata: {
          authorId: n.authorId,
          isPinned: n.isPinned,
        },
      })
    }

    entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    return entries
  }
}

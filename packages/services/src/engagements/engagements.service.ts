import {
  activities,
  engagementArtifacts,
  engagementEvents,
  engagements,
  stageTransitions,
} from '@phynd/db/schema'
import type { PaginatedResult, PaginationInput } from '@phynd/types/crm'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { ConflictError, NotFoundError } from '../errors'
import {
  type CotizaEngagementEvent,
  dispatchCotizaEngagementEvent,
} from './cotiza-engagement-emitter.service'
import { canonicalKarafielMilestone, canonicalSelvaMilestone } from './engagement-milestone.helpers'

/**
 * Optional DI seam for the Cotiza emitter so tests can spy without
 * patching a module import. Defaults to the real setImmediate-backed
 * fire-and-forget dispatcher.
 */
export type CotizaEngagementEmitter = (event: CotizaEngagementEvent) => void

export type EngagementTimelineEntry =
  | {
      kind: 'event'
      id: string
      createdAt: Date
      source: string
      eventType: string
      status: string | null
      message: string | null
      metadata: Record<string, unknown>
    }
  | {
      kind: 'activity'
      id: string
      createdAt: Date
      type: string
      title: string
      description: string | null
      completedAt: Date | null
    }
  | {
      kind: 'stage_transition'
      id: string
      createdAt: Date
      fromStageId: string | null
      toStageId: string
      entityType: string
      entityId: string
    }

export class EngagementsService {
  private readonly emitCotiza: CotizaEngagementEmitter

  constructor(
    private readonly ctx: ServiceContext,
    emitter: CotizaEngagementEmitter = dispatchCotizaEngagementEvent,
  ) {
    this.emitCotiza = emitter
  }

  async list(
    pagination?: PaginationInput,
    filters?: { contactId?: string; status?: string },
  ): Promise<PaginatedResult<typeof engagements.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [isNull(engagements.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(engagements.id, pagination.cursor))
    }
    if (filters?.contactId) {
      conditions.push(eq(engagements.contactId, filters.contactId))
    }
    if (filters?.status) {
      conditions.push(eq(engagements.status, filters.status))
    }

    const rows = await this.ctx.db
      .select()
      .from(engagements)
      .where(and(...conditions))
      .orderBy(engagements.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async getById(id: string) {
    const [row] = await this.ctx.db
      .select()
      .from(engagements)
      .where(and(eq(engagements.id, id), isNull(engagements.deletedAt)))
    return row ?? null
  }

  async create(data: {
    contactId: string
    opportunityId?: string
    projectName: string
    description?: string
    status?: string
    ownerId?: string
  }) {
    const [row] = await this.ctx.db
      .insert(engagements)
      .values({
        contactId: data.contactId,
        opportunityId: data.opportunityId,
        projectName: data.projectName,
        description: data.description,
        status: data.status ?? 'active',
        ownerId: data.ownerId,
      })
      .returning()
    if (!row) {
      throw new ConflictError('Failed to create engagement')
    }
    this.emitCotiza({
      engagementId: row.id,
      eventType: 'engagement.created',
      tenantId: this.ctx.tenantId,
      data: {
        project_name: row.projectName,
        status: row.status,
        contact_id: row.contactId,
      },
    })
    return row
  }

  async update(
    id: string,
    data: Partial<{
      projectName: string
      description: string
      status: string
      ownerId: string
    }>,
  ) {
    const existing = await this.getById(id)
    if (!existing) {
      throw new NotFoundError('Engagement', id)
    }
    const [row] = await this.ctx.db
      .update(engagements)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(engagements.id, id))
      .returning()
    if (row) {
      this.emitCotiza({
        engagementId: row.id,
        eventType: 'engagement.updated',
        tenantId: this.ctx.tenantId,
        data: {
          project_name: row.projectName,
          status: row.status,
          contact_id: row.contactId,
        },
      })
    }
    return row
  }

  async delete(id: string) {
    const existing = await this.getById(id)
    if (!existing) {
      throw new NotFoundError('Engagement', id)
    }
    await this.ctx.db
      .update(engagements)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(engagements.id, id))
    this.emitCotiza({
      engagementId: id,
      eventType: 'engagement.archived',
      tenantId: this.ctx.tenantId,
      data: {
        project_name: existing.projectName,
        status: existing.status,
        contact_id: existing.contactId,
      },
    })
  }

  // ─── Artifacts ──────────────────────────────────────────────────────

  async addArtifact(data: {
    engagementId: string
    type: string
    entityType?: string
    entityId?: string
    url?: string
    title?: string
    metadata?: Record<string, unknown>
  }) {
    const engagement = await this.getById(data.engagementId)
    if (!engagement) {
      throw new NotFoundError('Engagement', data.engagementId)
    }
    const [row] = await this.ctx.db
      .insert(engagementArtifacts)
      .values({
        engagementId: data.engagementId,
        type: data.type,
        entityType: data.entityType,
        entityId: data.entityId,
        url: data.url,
        title: data.title,
        metadata: data.metadata ?? {},
      })
      .returning()
    return row
  }

  async listArtifacts(engagementId: string) {
    return this.ctx.db
      .select()
      .from(engagementArtifacts)
      .where(eq(engagementArtifacts.engagementId, engagementId))
      .orderBy(desc(engagementArtifacts.createdAt))
  }

  // ─── Events ─────────────────────────────────────────────────────────

  async recordEvent(data: {
    engagementId: string
    source: string
    eventType: string
    status?: string
    message?: string
    metadata?: Record<string, unknown>
    dedupKey?: string
  }) {
    const engagement = await this.getById(data.engagementId)
    if (!engagement) {
      throw new NotFoundError('Engagement', data.engagementId)
    }

    // Idempotency: if dedupKey is provided and already exists for this
    // engagement, return the existing row instead of inserting again.
    if (data.dedupKey) {
      const [existing] = await this.ctx.db
        .select()
        .from(engagementEvents)
        .where(
          and(
            eq(engagementEvents.engagementId, data.engagementId),
            eq(engagementEvents.dedupKey, data.dedupKey),
          ),
        )
        .limit(1)
      if (existing) {
        return { event: existing, deduplicated: true as const }
      }
    }

    const [row] = await this.ctx.db
      .insert(engagementEvents)
      .values({
        engagementId: data.engagementId,
        source: data.source,
        eventType: data.eventType,
        status: data.status,
        message: data.message,
        metadata: data.metadata ?? {},
        dedupKey: data.dedupKey,
      })
      .returning()
    if (!row) {
      throw new ConflictError('Failed to record engagement event')
    }
    return { event: row, deduplicated: false as const }
  }

  /**
   * Records a native source event plus an optional canonical milestone alias
   * (separate dedup keys). Used by Selva, Karafiel, and Pravara webhooks.
   */
  async recordMilestoneWithCanonicalAlias(data: {
    engagementId: string
    source: 'selva' | 'karafiel' | 'pravara' | string
    nativeEventName: string
    externalId: string
    status?: string
    message?: string
    metadata?: Record<string, unknown>
    resolveCanonical?: (eventName: string) => string | null
  }) {
    const eventName = data.nativeEventName.replace(/^(selva|karafiel|pravara):/, '')
    const nativeEventType = `${data.source}:${eventName}`
    const dedupBase = `${data.source}:${data.externalId}`

    const primary = await this.recordEvent({
      engagementId: data.engagementId,
      source: data.source,
      eventType: nativeEventType,
      status: data.status,
      message: data.message,
      metadata: data.metadata,
      dedupKey: `${dedupBase}:${eventName}`,
    })

    const resolver =
      data.resolveCanonical ??
      (data.source === 'selva'
        ? canonicalSelvaMilestone
        : data.source === 'karafiel'
          ? canonicalKarafielMilestone
          : () => null)

    const canonicalName = resolver(eventName)
    if (!canonicalName) {
      return { primary, alias: null }
    }

    const alias = await this.recordEvent({
      engagementId: data.engagementId,
      source: data.source,
      eventType: `${data.source}:${canonicalName}`,
      status: 'milestone',
      message: data.message,
      metadata: {
        ...data.metadata,
        canonical_milestone: canonicalName,
      },
      dedupKey: `${dedupBase}:milestone:${canonicalName}`,
    })

    return { primary, alias }
  }

  // ─── Timeline ───────────────────────────────────────────────────────
  // Merges engagement_events with activities and stage_transitions for
  // the linked opportunity/contact into a single chronological feed the
  // client portal can render. Newest-first.
  async getTimeline(engagementId: string, limit = 100): Promise<EngagementTimelineEntry[]> {
    const engagement = await this.getById(engagementId)
    if (!engagement) {
      throw new NotFoundError('Engagement', engagementId)
    }

    const events = await this.ctx.db
      .select()
      .from(engagementEvents)
      .where(eq(engagementEvents.engagementId, engagementId))
      .orderBy(desc(engagementEvents.createdAt))
      .limit(limit)

    const activityRows = await this.ctx.db
      .select()
      .from(activities)
      .where(
        and(eq(activities.entityType, 'contact'), eq(activities.entityId, engagement.contactId)),
      )
      .orderBy(desc(activities.createdAt))
      .limit(limit)

    const transitionRows = engagement.opportunityId
      ? await this.ctx.db
          .select()
          .from(stageTransitions)
          .where(
            and(
              eq(stageTransitions.entityType, 'opportunity'),
              eq(stageTransitions.entityId, engagement.opportunityId),
            ),
          )
          .orderBy(desc(stageTransitions.transitionedAt))
          .limit(limit)
      : []

    const merged: EngagementTimelineEntry[] = [
      ...events.map(
        (e): EngagementTimelineEntry => ({
          kind: 'event',
          id: e.id,
          createdAt: e.createdAt,
          source: e.source,
          eventType: e.eventType,
          status: e.status,
          message: e.message,
          metadata: e.metadata ?? {},
        }),
      ),
      ...activityRows.map(
        (a): EngagementTimelineEntry => ({
          kind: 'activity',
          id: a.id,
          createdAt: a.createdAt,
          type: a.type,
          title: a.title,
          description: a.description,
          completedAt: a.completedAt,
        }),
      ),
      ...transitionRows.map(
        (t): EngagementTimelineEntry => ({
          kind: 'stage_transition',
          id: t.id,
          createdAt: t.transitionedAt,
          fromStageId: t.fromStageId,
          toStageId: t.toStageId,
          entityType: t.entityType,
          entityId: t.entityId,
        }),
      ),
    ]

    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return merged.slice(0, limit)
  }
}

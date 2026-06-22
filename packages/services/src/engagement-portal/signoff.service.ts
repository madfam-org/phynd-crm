import { engagementArtifacts, engagementEvents, engagements } from '@phynd/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { ConflictError, NotFoundError, ValidationError } from '../errors'

export interface AcceptDeliverableInput {
  engagementId: string
  artifactId: string
  acceptedByEmail: string
  acceptedByJanuaUserId: string
}

export class EngagementPortalSignoffService {
  constructor(private readonly ctx: ServiceContext) {}

  async acceptDeliverable(input: AcceptDeliverableInput) {
    const [engagement] = await this.ctx.db
      .select({ id: engagements.id })
      .from(engagements)
      .where(and(eq(engagements.id, input.engagementId), isNull(engagements.deletedAt)))
      .limit(1)

    if (!engagement) {
      throw new NotFoundError('Engagement', input.engagementId)
    }

    const [artifact] = await this.ctx.db
      .select()
      .from(engagementArtifacts)
      .where(
        and(
          eq(engagementArtifacts.id, input.artifactId),
          eq(engagementArtifacts.engagementId, input.engagementId),
        ),
      )
      .limit(1)

    if (!artifact) {
      throw new NotFoundError('Engagement artifact', input.artifactId)
    }

    if (artifact.type !== 'deliverable') {
      throw new ValidationError('Only deliverable artifacts can be accepted from the portal')
    }

    const dedupKey = `portal:deliverable_accepted:${artifact.id}`
    const [existing] = await this.ctx.db
      .select({ id: engagementEvents.id })
      .from(engagementEvents)
      .where(
        and(
          eq(engagementEvents.engagementId, input.engagementId),
          eq(engagementEvents.dedupKey, dedupKey),
        ),
      )
      .limit(1)

    if (existing) {
      return { accepted: true, deduplicated: true as const, eventId: existing.id }
    }

    const [event] = await this.ctx.db
      .insert(engagementEvents)
      .values({
        engagementId: input.engagementId,
        source: 'portal',
        eventType: 'portal:deliverable_accepted',
        status: 'completed',
        message: `Deliverable accepted: ${artifact.title ?? artifact.type}`,
        metadata: {
          artifact_id: artifact.id,
          artifact_title: artifact.title,
          accepted_by_email: input.acceptedByEmail,
          accepted_by_janua_id: input.acceptedByJanuaUserId,
        },
        dedupKey,
      })
      .returning()

    if (!event) {
      throw new ConflictError('Failed to record deliverable acceptance')
    }

    const milestoneDedup = `${dedupKey}:milestone`
    const [milestoneExists] = await this.ctx.db
      .select({ id: engagementEvents.id })
      .from(engagementEvents)
      .where(
        and(
          eq(engagementEvents.engagementId, input.engagementId),
          eq(engagementEvents.dedupKey, milestoneDedup),
        ),
      )
      .limit(1)

    if (!milestoneExists) {
      await this.ctx.db.insert(engagementEvents).values({
        engagementId: input.engagementId,
        source: 'system',
        eventType: 'system:deliverable_accepted',
        status: 'completed',
        message: `Client accepted deliverable ${artifact.title ?? artifact.id}`,
        metadata: {
          artifact_id: artifact.id,
          canonical_milestone: 'deliverable_received',
          accepted_by_email: input.acceptedByEmail,
        },
        dedupKey: milestoneDedup,
      })
    }

    return { accepted: true, deduplicated: false as const, eventId: event.id }
  }
}

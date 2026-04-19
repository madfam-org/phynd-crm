import { beforeEach, describe, expect, it } from 'vitest'
import { EngagementsService } from '../engagements/engagements.service'
import { NotFoundError } from '../errors'
import { createTestContext } from './helpers'

function makeEngagement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'eng-001',
    contactId: 'contact-001',
    opportunityId: null,
    projectName: 'Tablaco Prototype',
    description: 'Phase 1 + phase 2',
    status: 'active',
    ownerId: null,
    deletedAt: null,
    createdAt: new Date('2026-04-19T10:00:00Z'),
    updatedAt: new Date('2026-04-19T10:00:00Z'),
    ...overrides,
  }
}

describe('EngagementsService', () => {
  describe('recordEvent', () => {
    let ctx: ReturnType<typeof createTestContext>

    beforeEach(() => {
      ctx = createTestContext()
    })

    it('throws NotFoundError when engagement does not exist', async () => {
      ctx.mockDb._qb._result = []
      const service = new EngagementsService(ctx)
      await expect(
        service.recordEvent({
          engagementId: 'missing',
          source: 'pravara',
          eventType: 'shipped',
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('inserts a new event when engagement exists and no dedup_key provided', async () => {
      const engagement = makeEngagement()
      const insertedEvent = {
        id: 'evt-001',
        engagementId: 'eng-001',
        source: 'pravara',
        eventType: 'shipped',
        status: 'in_progress',
        message: 'Order shipped',
        metadata: {},
        dedupKey: null,
        createdAt: new Date(),
      }

      // First select returns engagement; insert.returning() returns inserted event
      ctx.mockDb._qb._result = [engagement]
      // Allow one .returning() after insert().values() to yield the inserted row
      ctx.mockDb.insert = (() => ({
        values: () => ({ returning: async () => [insertedEvent] }),
      })) as unknown as typeof ctx.mockDb.insert

      const service = new EngagementsService(ctx)
      const result = await service.recordEvent({
        engagementId: 'eng-001',
        source: 'pravara',
        eventType: 'shipped',
        status: 'in_progress',
        message: 'Order shipped',
      })

      expect(result.deduplicated).toBe(false)
      expect(result.event?.id).toBe('evt-001')
    })

    it('deduplicates when dedup_key already exists', async () => {
      const engagement = makeEngagement()
      const existingEvent = {
        id: 'evt-existing',
        engagementId: 'eng-001',
        source: 'pravara',
        eventType: 'shipped',
        status: null,
        message: null,
        metadata: {},
        dedupKey: 'pravara:order-abc:shipped',
        createdAt: new Date(),
      }

      // select() is called twice: once for engagement lookup, once for dedup lookup.
      // The helper's qb._result drives both — return engagement, then existing event.
      let selectCall = 0
      ctx.mockDb.select = (() => {
        selectCall += 1
        ctx.mockDb._qb._result = selectCall === 1 ? [engagement] : [existingEvent]
        return ctx.mockDb._qb
      }) as unknown as typeof ctx.mockDb.select

      const service = new EngagementsService(ctx)
      const result = await service.recordEvent({
        engagementId: 'eng-001',
        source: 'pravara',
        eventType: 'shipped',
        dedupKey: 'pravara:order-abc:shipped',
      })

      expect(result.deduplicated).toBe(true)
      expect(result.event.id).toBe('evt-existing')
    })
  })

  describe('addArtifact', () => {
    it('throws NotFoundError when engagement does not exist', async () => {
      const ctx = createTestContext([])
      const service = new EngagementsService(ctx)
      await expect(
        service.addArtifact({ engagementId: 'missing', type: 'signed_proposal' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('inserts artifact when engagement exists', async () => {
      const ctx = createTestContext([makeEngagement()])
      const insertedArtifact = {
        id: 'art-001',
        engagementId: 'eng-001',
        type: 'signed_proposal',
        entityType: 'quote',
        entityId: 'quote-abc',
        url: 'https://example.com/proposal.pdf',
        title: 'Proposal Q-2026-0001',
        metadata: {},
        createdAt: new Date(),
      }
      ctx.mockDb.insert = (() => ({
        values: () => ({ returning: async () => [insertedArtifact] }),
      })) as unknown as typeof ctx.mockDb.insert

      const service = new EngagementsService(ctx)
      const artifact = await service.addArtifact({
        engagementId: 'eng-001',
        type: 'signed_proposal',
        entityType: 'quote',
        entityId: 'quote-abc',
        url: 'https://example.com/proposal.pdf',
        title: 'Proposal Q-2026-0001',
      })

      expect(artifact?.id).toBe('art-001')
      expect(artifact?.type).toBe('signed_proposal')
    })
  })

  describe('getTimeline', () => {
    it('throws NotFoundError when engagement does not exist', async () => {
      const ctx = createTestContext([])
      const service = new EngagementsService(ctx)
      await expect(service.getTimeline('missing')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('merges events + activities into a single chronological feed', async () => {
      const engagement = makeEngagement({ opportunityId: null })
      const events = [
        {
          id: 'evt-1',
          engagementId: 'eng-001',
          source: 'pravara',
          eventType: 'shipped',
          status: 'in_progress',
          message: 'Order shipped',
          metadata: {},
          dedupKey: null,
          createdAt: new Date('2026-04-19T15:00:00Z'),
        },
      ]
      const activities = [
        {
          id: 'act-1',
          type: 'fabrication_update',
          title: 'Fabrication started',
          description: null,
          status: 'pending',
          dueAt: null,
          completedAt: null,
          entityType: 'contact',
          entityId: 'contact-001',
          ownerId: 'system',
          createdAt: new Date('2026-04-19T12:00:00Z'),
          updatedAt: new Date('2026-04-19T12:00:00Z'),
        },
      ]

      const ctx = createTestContext()
      let call = 0
      ctx.mockDb.select = (() => {
        call += 1
        // 1st: engagement lookup; 2nd: events; 3rd: activities. No transitions (opportunityId null).
        ctx.mockDb._qb._result =
          call === 1 ? [engagement] : call === 2 ? events : activities
        return ctx.mockDb._qb
      }) as unknown as typeof ctx.mockDb.select

      const service = new EngagementsService(ctx)
      const timeline = await service.getTimeline('eng-001', 50)

      expect(timeline).toHaveLength(2)
      // Newest first
      expect(timeline[0]?.kind).toBe('event')
      expect(timeline[1]?.kind).toBe('activity')
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CotizaEngagementEvent } from '../engagements/cotiza-engagement-emitter.service'
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

  describe('Cotiza emitter wiring', () => {
    it('fires engagement.created on create()', async () => {
      const ctx = createTestContext()
      const inserted = makeEngagement({ id: 'eng-new' })
      ctx.mockDb.insert = (() => ({
        values: () => ({ returning: async () => [inserted] }),
      })) as unknown as typeof ctx.mockDb.insert

      const emitter = vi.fn<(event: CotizaEngagementEvent) => void>()
      const service = new EngagementsService(ctx, emitter)

      await service.create({
        contactId: 'contact-001',
        projectName: 'Tablaco Prototype',
      })

      expect(emitter).toHaveBeenCalledTimes(1)
      const event = emitter.mock.calls[0]?.[0]
      expect(event?.eventType).toBe('engagement.created')
      expect(event?.engagementId).toBe('eng-new')
      expect(event?.tenantId).toBe('madfam')
      expect(event?.data?.project_name).toBe('Tablaco Prototype')
      expect(event?.data?.contact_id).toBe('contact-001')
    })

    it('fires engagement.updated on update()', async () => {
      const ctx = createTestContext()
      const existing = makeEngagement()
      const updated = makeEngagement({ status: 'paused', projectName: 'Renamed' })

      // getById → existing; update().returning() → updated
      let selectCall = 0
      ctx.mockDb.select = (() => {
        selectCall += 1
        ctx.mockDb._qb._result = selectCall === 1 ? [existing] : []
        return ctx.mockDb._qb
      }) as unknown as typeof ctx.mockDb.select
      ctx.mockDb.update = (() => ({
        set: () => ({
          where: () => ({ returning: async () => [updated] }),
        }),
      })) as unknown as typeof ctx.mockDb.update

      const emitter = vi.fn<(event: CotizaEngagementEvent) => void>()
      const service = new EngagementsService(ctx, emitter)

      await service.update('eng-001', { status: 'paused', projectName: 'Renamed' })

      expect(emitter).toHaveBeenCalledTimes(1)
      const event = emitter.mock.calls[0]?.[0]
      expect(event?.eventType).toBe('engagement.updated')
      expect(event?.engagementId).toBe('eng-001')
      expect(event?.data?.status).toBe('paused')
      expect(event?.data?.project_name).toBe('Renamed')
    })

    it('fires engagement.archived on delete()', async () => {
      const ctx = createTestContext([makeEngagement()])
      // Soft-delete uses .update().set().where() — no .returning(), resolve to undefined.
      ctx.mockDb.update = (() => ({
        set: () => ({ where: async () => undefined }),
      })) as unknown as typeof ctx.mockDb.update

      const emitter = vi.fn<(event: CotizaEngagementEvent) => void>()
      const service = new EngagementsService(ctx, emitter)

      await service.delete('eng-001')

      expect(emitter).toHaveBeenCalledTimes(1)
      const event = emitter.mock.calls[0]?.[0]
      expect(event?.eventType).toBe('engagement.archived')
      expect(event?.engagementId).toBe('eng-001')
      expect(event?.data?.project_name).toBe('Tablaco Prototype')
    })

    it('does not fire when update() finds no engagement (throws first)', async () => {
      const ctx = createTestContext([])
      const emitter = vi.fn<(event: CotizaEngagementEvent) => void>()
      const service = new EngagementsService(ctx, emitter)

      await expect(service.update('missing', { status: 'paused' })).rejects.toBeInstanceOf(
        NotFoundError,
      )

      expect(emitter).not.toHaveBeenCalled()
    })

    it('does not fire when delete() finds no engagement (throws first)', async () => {
      const ctx = createTestContext([])
      const emitter = vi.fn<(event: CotizaEngagementEvent) => void>()
      const service = new EngagementsService(ctx, emitter)

      await expect(service.delete('missing')).rejects.toBeInstanceOf(NotFoundError)

      expect(emitter).not.toHaveBeenCalled()
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
        ctx.mockDb._qb._result = call === 1 ? [engagement] : call === 2 ? events : activities
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

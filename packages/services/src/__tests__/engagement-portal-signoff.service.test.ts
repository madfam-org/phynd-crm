import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngagementPortalSignoffService } from '../engagement-portal/signoff.service'
import { ValidationError } from '../errors'
import { createMockQueryBuilder, createTestContext } from './helpers'

vi.mock('@phynd/db/schema', () => ({
  engagementArtifacts: {
    id: 'engagementArtifacts.id',
    engagementId: 'engagementArtifacts.engagementId',
    type: 'engagementArtifacts.type',
    title: 'engagementArtifacts.title',
  },
  engagementEvents: {
    id: 'engagementEvents.id',
    engagementId: 'engagementEvents.engagementId',
    dedupKey: 'engagementEvents.dedupKey',
    eventType: 'engagementEvents.eventType',
  },
  engagements: { id: 'engagements.id', deletedAt: 'engagements.deletedAt' },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

describe('EngagementPortalSignoffService', () => {
  let ctx: ReturnType<typeof createTestContext>

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('records deliverable acceptance with milestone alias', async () => {
    const artifact = {
      id: 'art-001',
      engagementId: 'eng-001',
      type: 'deliverable',
      title: 'Prototype package',
    }

    let selectCount = 0
    ctx.db.select = vi.fn(() => {
      selectCount += 1
      if (selectCount === 1) return createMockQueryBuilder([{ id: 'eng-001' }])
      if (selectCount === 2) return createMockQueryBuilder([artifact])
      if (selectCount === 3) return createMockQueryBuilder([])
      return createMockQueryBuilder([])
    }) as unknown as typeof ctx.db.select

    ctx.db.insert = vi.fn(() =>
      createMockQueryBuilder([{ id: 'evt-accept-001' }]),
    ) as unknown as typeof ctx.db.insert

    const service = new EngagementPortalSignoffService(ctx)
    const result = await service.acceptDeliverable({
      engagementId: 'eng-001',
      artifactId: 'art-001',
      acceptedByEmail: 'client@example.com',
      acceptedByJanuaUserId: 'janua-001',
    })

    expect(result.accepted).toBe(true)
    expect(result.deduplicated).toBe(false)
    expect(ctx.db.insert).toHaveBeenCalledTimes(2)
  })

  it("writes the client's own acceptance as client-visible and the alias as internal", async () => {
    const artifact = {
      id: 'art-001',
      engagementId: 'eng-001',
      type: 'deliverable',
      title: 'Prototype package',
    }
    let selectCount = 0
    ctx.db.select = vi.fn(() => {
      selectCount += 1
      if (selectCount === 1) return createMockQueryBuilder([{ id: 'eng-001' }])
      if (selectCount === 2) return createMockQueryBuilder([artifact])
      return createMockQueryBuilder([])
    }) as unknown as typeof ctx.db.select
    const builders: Array<ReturnType<typeof createMockQueryBuilder>> = []
    ctx.db.insert = vi.fn(() => {
      const qb = createMockQueryBuilder([{ id: `evt-${builders.length + 1}` }])
      builders.push(qb)
      return qb
    }) as unknown as typeof ctx.db.insert

    await new EngagementPortalSignoffService(ctx).acceptDeliverable({
      engagementId: 'eng-001',
      artifactId: 'art-001',
      acceptedByEmail: 'persona@example.invalid',
      acceptedByJanuaUserId: 'janua-001',
    })

    const written = builders.map((qb) => qb.values.mock.calls[0]?.[0] as Record<string, unknown>)
    expect(written.map((v) => [v.eventType, v.visibility])).toEqual([
      ['portal:deliverable_accepted', 'client'],
      ['system:deliverable_accepted', 'internal'],
    ])
  })

  it('rejects non-deliverable artifacts', async () => {
    ctx.db.select = vi
      .fn()
      .mockReturnValueOnce(createMockQueryBuilder([{ id: 'eng-001' }]))
      .mockReturnValueOnce(
        createMockQueryBuilder([
          { id: 'art-002', engagementId: 'eng-001', type: 'invoice', title: 'Invoice' },
        ]),
      ) as unknown as typeof ctx.db.select

    const service = new EngagementPortalSignoffService(ctx)
    await expect(
      service.acceptDeliverable({
        engagementId: 'eng-001',
        artifactId: 'art-002',
        acceptedByEmail: 'client@example.com',
        acceptedByJanuaUserId: 'janua-001',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

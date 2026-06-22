import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PublishQuoteToPortalService } from '../engagements/publish-quote-to-portal.service'
import { ValidationError } from '../errors'
import { createMockQueryBuilder, createTestContext } from './helpers'

vi.mock('@phynd/db/schema', () => ({
  engagementArtifacts: { engagementId: 'engagementArtifacts.engagementId' },
  engagementEvents: { engagementId: 'engagementEvents.engagementId' },
  engagements: { id: 'engagements.id', deletedAt: 'engagements.deletedAt' },
  quotes: { id: 'quotes.id', deletedAt: 'quotes.deletedAt' },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  desc: vi.fn((col: unknown) => ({ _tag: 'desc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

describe('PublishQuoteToPortalService', () => {
  let ctx: ReturnType<typeof createTestContext>

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('marks a draft quote as sent and writes a quote_sent milestone', async () => {
    const engagement = {
      id: 'eng-001',
      contactId: 'contact-001',
      opportunityId: 'opp-001',
      deletedAt: null,
    }
    const quote = {
      id: 'quote-001',
      contactId: 'contact-001',
      opportunityId: 'opp-001',
      quoteNumber: 'Q-2026-0001',
      status: 'draft',
      totalAmount: '25000.00',
      currency: 'USD',
      deletedAt: null,
    }

    const engagementSelect = createMockQueryBuilder([engagement])
    const quoteSelect = createMockQueryBuilder([quote])
    const artifactSelect = createMockQueryBuilder([])
    const quoteUpdate = createMockQueryBuilder([{ ...quote, status: 'sent' }])

    let selectCount = 0
    ctx.db.select = vi.fn(() => {
      selectCount += 1
      if (selectCount === 1) return engagementSelect
      if (selectCount === 2) return quoteSelect
      return artifactSelect
    }) as unknown as typeof ctx.db.select
    ctx.db.update = vi.fn(() => quoteUpdate) as unknown as typeof ctx.db.update
    ctx.db.insert = vi.fn(() => createMockQueryBuilder([])) as unknown as typeof ctx.db.insert

    const service = new PublishQuoteToPortalService(ctx)
    const result = await service.publish({ engagementId: 'eng-001' })

    expect(result).toEqual({
      quoteId: 'quote-001',
      quoteNumber: 'Q-2026-0001',
      quoteStatus: 'sent',
      alreadyPublished: false,
    })
    expect(ctx.db.update).toHaveBeenCalled()
    expect(ctx.db.insert).toHaveBeenCalledTimes(2)
  })

  it('returns alreadyPublished when the quote is already sent', async () => {
    const engagement = {
      id: 'eng-001',
      contactId: 'contact-001',
      opportunityId: 'opp-001',
      deletedAt: null,
    }
    const quote = {
      id: 'quote-001',
      contactId: 'contact-001',
      opportunityId: 'opp-001',
      quoteNumber: 'Q-2026-0001',
      status: 'sent',
      totalAmount: '25000.00',
      currency: 'USD',
      deletedAt: null,
    }

    const engagementSelect = createMockQueryBuilder([engagement])
    const quoteSelect = createMockQueryBuilder([quote])

    let selectCount = 0
    ctx.db.select = vi.fn(() => {
      selectCount += 1
      return selectCount === 1 ? engagementSelect : quoteSelect
    }) as unknown as typeof ctx.db.select

    const service = new PublishQuoteToPortalService(ctx)
    const result = await service.publish({ engagementId: 'eng-001' })

    expect(result.alreadyPublished).toBe(true)
    expect(result.quoteStatus).toBe('sent')
    expect(ctx.db.update).not.toHaveBeenCalled()
  })

  it('rejects quotes that are not draft or sent', async () => {
    const engagement = {
      id: 'eng-001',
      contactId: 'contact-001',
      opportunityId: 'opp-001',
      deletedAt: null,
    }
    const quote = {
      id: 'quote-001',
      contactId: 'contact-001',
      opportunityId: 'opp-001',
      quoteNumber: 'Q-2026-0001',
      status: 'accepted',
      deletedAt: null,
    }

    const engagementSelect = createMockQueryBuilder([engagement])
    const quoteSelect = createMockQueryBuilder([quote])

    let selectCount = 0
    ctx.db.select = vi.fn(() => {
      selectCount += 1
      return selectCount === 1 ? engagementSelect : quoteSelect
    }) as unknown as typeof ctx.db.select

    const service = new PublishQuoteToPortalService(ctx)
    await expect(service.publish({ engagementId: 'eng-001' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })
})

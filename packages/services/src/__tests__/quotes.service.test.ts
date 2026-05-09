import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuotesService } from '../quotes/quotes.service'
import {
  type MockDatabase,
  createTestContext,
  makeOpportunity,
  makeOrder,
  makeQuote,
} from './helpers'

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

vi.mock('@phynd/db/schema', () => ({
  conversions: { id: 'conversions.id', type: 'conversions.type' },
  engagementEvents: { id: 'engagementEvents.id' },
  engagements: {
    contactId: 'engagements.contactId',
    deletedAt: 'engagements.deletedAt',
    id: 'engagements.id',
    opportunityId: 'engagements.opportunityId',
    status: 'engagements.status',
  },
  notifications: { id: 'notifications.id' },
  opportunities: {
    deletedAt: 'opportunities.deletedAt',
    id: 'opportunities.id',
    status: 'opportunities.status',
  },
  orders: {
    deletedAt: 'orders.deletedAt',
    id: 'orders.id',
    quoteId: 'orders.quoteId',
  },
  quotes: {
    contactId: 'quotes.contactId',
    deletedAt: 'quotes.deletedAt',
    id: 'quotes.id',
    opportunityId: 'quotes.opportunityId',
    ownerId: 'quotes.ownerId',
  },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuotesService', () => {
  let service: QuotesService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new QuotesService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------
  describe('list()', () => {
    it('returns paginated quotes with default limit', async () => {
      const items = [makeQuote({ id: 'q-001' }), makeQuote({ id: 'q-002' })]
      mockDb._qb._result = items

      const result = await service.list()

      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })

    it('detects hasMore when result count exceeds limit', async () => {
      const items = [
        makeQuote({ id: 'q-001' }),
        makeQuote({ id: 'q-002' }),
        makeQuote({ id: 'q-003' }),
      ]
      mockDb._qb._result = items

      const result = await service.list({ limit: 2 })

      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
      expect(result.nextCursor).toBe('q-002')
    })

    it('applies cursor for cursor-based pagination', async () => {
      mockDb._qb._result = [makeQuote({ id: 'q-005' })]

      const result = await service.list({ cursor: 'q-004', limit: 10 })

      expect(result.items).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns empty result when no quotes exist', async () => {
      mockDb._qb._result = []

      const result = await service.list()

      expect(result.items).toHaveLength(0)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })

    it('filters by ownerId', async () => {
      mockDb._qb._result = [makeQuote({ id: 'q-001', ownerId: 'owner-1' })]

      const result = await service.list(undefined, { ownerId: 'owner-1' })

      expect(result.items).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // getById()
  // -------------------------------------------------------------------------
  describe('getById()', () => {
    it('returns a quote when found', async () => {
      const quote = makeQuote({ id: 'q-123' })
      mockDb._qb._result = [quote]

      const result = await service.getById('q-123')

      expect(result).toEqual(quote)
    })

    it('returns null when not found', async () => {
      mockDb._qb._result = []

      const result = await service.getById('nonexistent')

      expect(result).toBeNull()
    })

    it('filters out soft-deleted quotes', async () => {
      mockDb._qb._result = []

      await service.getById('q-deleted')

      expect(mockDb._qb.where).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('creates a quote and returns it', async () => {
      const newQuote = makeQuote({ id: 'q-new' })
      mockDb._qb._result = [newQuote]

      const result = await service.create({
        quoteNumber: 'Q-2025-001',
        totalAmount: '5000.00',
      })

      expect(result).toEqual(newQuote)
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------
  describe('update()', () => {
    it('updates a quote and returns the updated record', async () => {
      const updated = makeQuote({ id: 'q-001', totalAmount: '7500.00' })
      mockDb._qb._result = [updated]

      const result = await service.update('q-001', { totalAmount: '7500.00' })

      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('returns null for nonexistent quote', async () => {
      mockDb._qb._result = []

      const result = await service.update('nonexistent', { status: 'sent' })

      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // accept()
  // -------------------------------------------------------------------------
  describe('accept()', () => {
    it('accepts a quote, creates a confirmed order, marks the opportunity won, and records the milestone', async () => {
      const quote = makeQuote({
        id: 'quote-001',
        contactId: 'contact-001',
        opportunityId: 'opp-001',
        ownerId: 'owner-001',
        quoteNumber: 'Q-2026-0007',
        status: 'sent',
        totalAmount: '42000.00',
        currency: 'MXN',
      })
      const acceptedQuote = makeQuote({ ...quote, status: 'accepted' })
      const order = makeOrder({
        id: 'order-001',
        contactId: 'contact-001',
        opportunityId: 'opp-001',
        quoteId: 'quote-001',
        orderNumber: 'ORD-2026-0007',
        status: 'confirmed',
        totalAmount: '42000.00',
        currency: 'MXN',
        ownerId: 'owner-001',
      })
      const opportunity = makeOpportunity({
        id: 'opp-001',
        contactId: 'contact-001',
        status: 'open',
        value: '42000.00',
      })
      const engagement = {
        id: 'eng-001',
        contactId: 'contact-001',
        opportunityId: 'opp-001',
        status: 'active',
      }

      installAwaitSequence([
        [quote],
        [acceptedQuote],
        [],
        [order],
        [opportunity],
        [{ ...opportunity, status: 'won', probability: 100 }],
        [],
        [],
        [engagement],
        [],
      ])

      const result = await service.accept('quote-001', { source: 'crm' })

      expect(result).toEqual({ engagementId: 'eng-001', order, quote: acceptedQuote })
      expect(mockDb.transaction).toHaveBeenCalled()
      expect(mockDb._qb.set).toHaveBeenCalledWith({ status: 'accepted' })
      expect(mockDb._qb.set).toHaveBeenCalledWith({ status: 'won', probability: 100 })

      const values = mockDb._qb.values.mock.calls.map((call) => call[0] as Record<string, unknown>)
      expect(values).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            orderNumber: 'ORD-2026-0007',
            quoteId: 'quote-001',
            status: 'confirmed',
            totalAmount: '42000.00',
            currency: 'MXN',
          }),
          expect.objectContaining({
            type: 'opportunity_to_won',
            contactId: 'contact-001',
            opportunityId: 'opp-001',
            value: '42000.00',
          }),
          expect.objectContaining({
            type: 'quote_accepted',
            contactId: 'contact-001',
            opportunityId: 'opp-001',
            value: '42000.00',
          }),
          expect.objectContaining({
            engagementId: 'eng-001',
            source: 'system',
            eventType: 'system:quote_approved',
            status: 'milestone',
            dedupKey: 'quote:quote-001:accepted',
          }),
        ]),
      )
    })

    it('does not duplicate conversion or timeline side effects when the quote is already accepted', async () => {
      const quote = makeQuote({
        id: 'quote-001',
        contactId: 'contact-001',
        opportunityId: 'opp-001',
        status: 'accepted',
      })
      const order = makeOrder({
        id: 'order-001',
        quoteId: 'quote-001',
        status: 'confirmed',
      })
      const engagement = {
        id: 'eng-001',
        contactId: 'contact-001',
        opportunityId: 'opp-001',
        status: 'active',
      }

      installAwaitSequence([[quote], [quote], [order], [engagement]])

      const result = await service.accept('quote-001')

      expect(result).toEqual({ engagementId: 'eng-001', order, quote })
      expect(mockDb._qb.values).not.toHaveBeenCalled()
    })

    it('rejects declined or expired quotes before mutating lifecycle records', async () => {
      const quote = makeQuote({
        id: 'quote-001',
        quoteNumber: 'Q-2026-0007',
        status: 'declined',
      })

      installAwaitSequence([[quote]])

      await expect(service.accept('quote-001')).rejects.toThrow(
        'Quote Q-2026-0007 cannot be accepted from status declined',
      )
      expect(mockDb._qb.set).not.toHaveBeenCalled()
      expect(mockDb._qb.values).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // delete() — soft delete
  // -------------------------------------------------------------------------
  describe('delete()', () => {
    it('performs a soft delete by setting deletedAt', async () => {
      const deleted = makeQuote({ deletedAt: new Date(), id: 'q-001' })
      mockDb._qb._result = [deleted]

      const result = await service.delete('q-001')

      expect(result).toEqual(deleted)
      expect(mockDb.update).toHaveBeenCalled()
      const setArg = mockDb._qb.set.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(setArg?.deletedAt).toBeInstanceOf(Date)
    })

    it('returns null for nonexistent quote', async () => {
      mockDb._qb._result = []

      const result = await service.delete('nonexistent')

      expect(result).toBeNull()
    })
  })

  function installAwaitSequence(results: unknown[][]) {
    let callCount = 0
    mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
      const result = results[callCount] ?? []
      callCount += 1
      return Promise.resolve(result).then(resolve)
    })
  }
})

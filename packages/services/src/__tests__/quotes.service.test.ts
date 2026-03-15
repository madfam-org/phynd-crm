import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuotesService } from '../quotes/quotes.service'
import { type MockDatabase, createTestContext, makeQuote } from './helpers'

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

vi.mock('@phyne/db/schema', () => ({
  notifications: { id: 'notifications.id' },
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
})

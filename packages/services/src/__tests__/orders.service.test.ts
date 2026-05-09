import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrdersService } from '../orders/orders.service'
import { type MockDatabase, createTestContext, makeOpportunity, makeOrder } from './helpers'

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
  notifications: { id: 'notifications.id' },
  opportunities: {
    deletedAt: 'opportunities.deletedAt',
    id: 'opportunities.id',
    status: 'opportunities.status',
  },
  orders: {
    contactId: 'orders.contactId',
    deletedAt: 'orders.deletedAt',
    id: 'orders.id',
    opportunityId: 'orders.opportunityId',
    ownerId: 'orders.ownerId',
    quoteId: 'orders.quoteId',
  },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrdersService', () => {
  let service: OrdersService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new OrdersService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------
  describe('list()', () => {
    it('returns paginated orders with default limit', async () => {
      const items = [makeOrder({ id: 'ord-001' }), makeOrder({ id: 'ord-002' })]
      mockDb._qb._result = items

      const result = await service.list()

      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })

    it('detects hasMore when result count exceeds limit', async () => {
      const items = [
        makeOrder({ id: 'ord-001' }),
        makeOrder({ id: 'ord-002' }),
        makeOrder({ id: 'ord-003' }),
      ]
      mockDb._qb._result = items

      const result = await service.list({ limit: 2 })

      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
      expect(result.nextCursor).toBe('ord-002')
    })

    it('applies cursor for cursor-based pagination', async () => {
      mockDb._qb._result = [makeOrder({ id: 'ord-005' })]

      const result = await service.list({ cursor: 'ord-004', limit: 10 })

      expect(result.items).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns empty result when no orders exist', async () => {
      mockDb._qb._result = []

      const result = await service.list()

      expect(result.items).toHaveLength(0)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })

    it('filters by ownerId', async () => {
      mockDb._qb._result = [makeOrder({ id: 'ord-001', ownerId: 'owner-1' })]

      const result = await service.list(undefined, { ownerId: 'owner-1' })

      expect(result.items).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // getById()
  // -------------------------------------------------------------------------
  describe('getById()', () => {
    it('returns an order when found', async () => {
      const order = makeOrder({ id: 'ord-123' })
      mockDb._qb._result = [order]

      const result = await service.getById('ord-123')

      expect(result).toEqual(order)
    })

    it('returns null when not found', async () => {
      mockDb._qb._result = []

      const result = await service.getById('nonexistent')

      expect(result).toBeNull()
    })

    it('filters out soft-deleted orders', async () => {
      mockDb._qb._result = []

      await service.getById('ord-deleted')

      expect(mockDb._qb.where).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('creates an order and returns it', async () => {
      const newOrder = makeOrder({ id: 'ord-new' })
      mockDb._qb._result = [newOrder]

      const result = await service.create({
        orderNumber: 'ORD-2025-001',
        totalAmount: '15000.00',
      })

      expect(result).toEqual(newOrder)
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------
  describe('update()', () => {
    it('updates an order and returns the updated record', async () => {
      const updated = makeOrder({ id: 'ord-001', totalAmount: '20000.00' })
      mockDb._qb._result = [updated]

      const result = await service.update('ord-001', { totalAmount: '20000.00' })

      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('returns null for nonexistent order', async () => {
      mockDb._qb._result = []

      const result = await service.update('nonexistent', { status: 'confirmed' })

      expect(result).toBeNull()
    })

    it('auto-marks opportunity as won when order status changes to fulfilled', async () => {
      const order = makeOrder({
        id: 'ord-001',
        opportunityId: 'opp-001',
        status: 'fulfilled',
      })
      const opp = makeOpportunity({ id: 'opp-001', status: 'open' })

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) {
          // update().returning() for order
          return Promise.resolve([order]).then(resolve)
        }
        if (callCount === 2) {
          // select() for opportunity in transaction
          return Promise.resolve([opp]).then(resolve)
        }
        // Subsequent calls (update opp, insert conversion)
        return Promise.resolve([{ ...opp, status: 'won' }]).then(resolve)
      })

      const result = await service.update('ord-001', { status: 'fulfilled' })

      expect(result).toEqual(order)
      // Transaction called for auto-mark opportunity as won
      expect(mockDb.transaction).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // delete() — soft delete
  // -------------------------------------------------------------------------
  describe('delete()', () => {
    it('performs a soft delete by setting deletedAt', async () => {
      const deleted = makeOrder({ deletedAt: new Date(), id: 'ord-001' })
      mockDb._qb._result = [deleted]

      const result = await service.delete('ord-001')

      expect(result).toEqual(deleted)
      expect(mockDb.update).toHaveBeenCalled()
      const setArg = mockDb._qb.set.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(setArg?.deletedAt).toBeInstanceOf(Date)
    })

    it('returns null for nonexistent order', async () => {
      mockDb._qb._result = []

      const result = await service.delete('nonexistent')

      expect(result).toBeNull()
    })
  })
})

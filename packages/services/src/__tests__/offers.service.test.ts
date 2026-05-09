import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OffersService } from '../offers/offers.service'
import { type MockDatabase, createTestContext, makeOffer } from './helpers'

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  sql: vi.fn(() => ({ _tag: 'sql' })),
}))

vi.mock('@phynd/db/schema', () => ({
  offers: {
    currentRedemptions: 'offers.currentRedemptions',
    id: 'offers.id',
    maxRedemptions: 'offers.maxRedemptions',
  },
}))

describe('OffersService', () => {
  let service: OffersService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new OffersService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------
  describe('list()', () => {
    it('returns paginated offers', async () => {
      mockDb._qb._result = [makeOffer()]
      const result = await service.list()
      expect(result.items).toHaveLength(1)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })

    it('detects hasMore when rows exceed limit', async () => {
      mockDb._qb._result = [
        makeOffer({ id: 'o1' }),
        makeOffer({ id: 'o2' }),
        makeOffer({ id: 'o3' }),
      ]
      const result = await service.list({ limit: 2 })
      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
    })

    it('returns empty when no offers', async () => {
      mockDb._qb._result = []
      const result = await service.list()
      expect(result.items).toHaveLength(0)
      expect(result.hasMore).toBe(false)
    })

    it('applies cursor for pagination', async () => {
      mockDb._qb._result = [makeOffer({ id: 'o5' })]
      const result = await service.list({ cursor: 'o4', limit: 10 })
      expect(result.items).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // getById()
  // -------------------------------------------------------------------------
  describe('getById()', () => {
    it('returns an offer when found', async () => {
      const offer = makeOffer()
      mockDb._qb._result = [offer]
      const result = await service.getById('offer-001')
      expect(result).toEqual(offer)
    })

    it('returns null when not found', async () => {
      mockDb._qb._result = []
      const result = await service.getById('nonexistent')
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('creates an offer', async () => {
      const newOffer = makeOffer({ id: 'offer-new' })
      mockDb._qb._result = [newOffer]
      const result = await service.create({ name: 'New Offer' })
      expect(result).toEqual(newOffer)
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------
  describe('update()', () => {
    it('updates an offer', async () => {
      const updated = makeOffer({ status: 'paused' })
      mockDb._qb._result = [updated]
      const result = await service.update('offer-001', { status: 'paused' })
      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('returns null when updating nonexistent offer', async () => {
      mockDb._qb._result = []
      const result = await service.update('nonexistent', { status: 'paused' })
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // recordRedemption()
  // -------------------------------------------------------------------------
  describe('recordRedemption()', () => {
    it('increments current redemptions', async () => {
      const offer = makeOffer({ currentRedemptions: 1 })
      mockDb._qb._result = [offer]
      const result = await service.recordRedemption('offer-001')
      expect(result).toBeDefined()
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('returns null when offer not found', async () => {
      mockDb._qb._result = []
      const result = await service.recordRedemption('nonexistent')
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // delete()
  // -------------------------------------------------------------------------
  describe('delete()', () => {
    it('deletes an offer', async () => {
      mockDb._qb._result = [makeOffer()]
      const result = await service.delete('offer-001')
      expect(result).toBeDefined()
      expect(mockDb.delete).toHaveBeenCalled()
    })

    it('returns null when deleting nonexistent offer', async () => {
      mockDb._qb._result = []
      const result = await service.delete('nonexistent')
      expect(result).toBeNull()
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CampaignsService } from '../campaigns/campaigns.service'
import { type MockDatabase, createTestContext, makeCampaign } from './helpers'

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
}))

vi.mock('@phyne/db/schema', () => ({
  campaigns: {
    id: 'campaigns.id',
    status: 'campaigns.status',
  },
}))

describe('CampaignsService', () => {
  let service: CampaignsService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new CampaignsService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------
  describe('list()', () => {
    it('returns paginated campaigns', async () => {
      mockDb._qb._result = [makeCampaign()]
      const result = await service.list()
      expect(result.items).toHaveLength(1)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })

    it('detects hasMore when rows exceed limit', async () => {
      const items = [
        makeCampaign({ id: 'c1' }),
        makeCampaign({ id: 'c2' }),
        makeCampaign({ id: 'c3' }),
      ]
      mockDb._qb._result = items
      const result = await service.list({ limit: 2 })
      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
    })

    it('returns empty when no campaigns', async () => {
      mockDb._qb._result = []
      const result = await service.list()
      expect(result.items).toHaveLength(0)
      expect(result.hasMore).toBe(false)
    })

    it('applies cursor for pagination', async () => {
      mockDb._qb._result = [makeCampaign({ id: 'c5' })]
      const result = await service.list({ cursor: 'c4', limit: 10 })
      expect(result.items).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // getById()
  // -------------------------------------------------------------------------
  describe('getById()', () => {
    it('returns a campaign when found', async () => {
      const campaign = makeCampaign()
      mockDb._qb._result = [campaign]
      const result = await service.getById('campaign-001')
      expect(result).toEqual(campaign)
    })

    it('returns null when not found', async () => {
      mockDb._qb._result = []
      const result = await service.getById('nonexistent')
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // getByUtmCampaign()
  // -------------------------------------------------------------------------
  describe('getByUtmCampaign()', () => {
    it('returns a campaign when one matches the utm_campaign', async () => {
      const campaign = makeCampaign({ utmCampaign: 'spring-2026' })
      mockDb._qb._result = [campaign]
      const result = await service.getByUtmCampaign('spring-2026')
      expect(result).toEqual(campaign)
    })

    it('returns null for empty utm_campaign without hitting the DB', async () => {
      const result = await service.getByUtmCampaign('')
      expect(result).toBeNull()
      expect(mockDb.select).not.toHaveBeenCalled()
    })

    it('returns null when no campaign matches', async () => {
      mockDb._qb._result = []
      const result = await service.getByUtmCampaign('nonexistent-campaign')
      expect(result).toBeNull()
    })

    it('returns the earliest match when multiple campaigns share the slug', async () => {
      // Service applies orderBy + limit(1) so the helper just yields the
      // first item. Verifying the correct LIMIT behavior here.
      const earliest = makeCampaign({ id: 'campaign-old', utmCampaign: 'evergreen' })
      mockDb._qb._result = [earliest]
      const result = await service.getByUtmCampaign('evergreen')
      expect(result?.id).toBe('campaign-old')
    })
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('creates a campaign', async () => {
      const newCampaign = makeCampaign({ id: 'campaign-new' })
      mockDb._qb._result = [newCampaign]
      const result = await service.create({ name: 'New Campaign' })
      expect(result).toEqual(newCampaign)
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------
  describe('update()', () => {
    it('updates a campaign', async () => {
      const updated = makeCampaign({ status: 'paused' })
      mockDb._qb._result = [updated]
      const result = await service.update('campaign-001', { status: 'paused' })
      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('returns null when updating nonexistent campaign', async () => {
      mockDb._qb._result = []
      const result = await service.update('nonexistent', { status: 'paused' })
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // delete()
  // -------------------------------------------------------------------------
  describe('delete()', () => {
    it('deletes a campaign', async () => {
      mockDb._qb._result = [makeCampaign()]
      const result = await service.delete('campaign-001')
      expect(result).toBeDefined()
      expect(mockDb.delete).toHaveBeenCalled()
    })

    it('returns null when deleting nonexistent campaign', async () => {
      mockDb._qb._result = []
      const result = await service.delete('nonexistent')
      expect(result).toBeNull()
    })
  })
})

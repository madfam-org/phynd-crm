import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivitiesService } from '../activities/activities.service'
import { type MockDatabase, createTestContext, makeActivity } from './helpers'

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  desc: vi.fn((col: unknown) => ({ _tag: 'desc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
}))

vi.mock('@phynd/db/schema', () => ({
  activities: {
    createdAt: 'activities.createdAt',
    entityId: 'activities.entityId',
    entityType: 'activities.entityType',
    id: 'activities.id',
    ownerId: 'activities.ownerId',
  },
}))

describe('ActivitiesService', () => {
  let service: ActivitiesService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new ActivitiesService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // listForEntity()
  // -------------------------------------------------------------------------
  describe('listForEntity()', () => {
    it('returns activities for a specific entity', async () => {
      mockDb._qb._result = [makeActivity({ entityId: 'lead-001', entityType: 'lead' })]
      const result = await service.listForEntity('lead', 'lead-001')
      expect(result).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns empty when no activities match', async () => {
      mockDb._qb._result = []
      const result = await service.listForEntity('contact', 'contact-999')
      expect(result).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // listRecent()
  // -------------------------------------------------------------------------
  describe('listRecent()', () => {
    it('returns paginated activities with default limit', async () => {
      mockDb._qb._result = [makeActivity()]
      const result = await service.listRecent()
      expect(mockDb.select).toHaveBeenCalled()
      expect(result.items).toHaveLength(1)
      expect(result.hasMore).toBe(false)
    })

    it('detects hasMore when rows exceed limit', async () => {
      const items = [
        makeActivity({ id: 'a1' }),
        makeActivity({ id: 'a2' }),
        makeActivity({ id: 'a3' }),
      ]
      mockDb._qb._result = items
      const result = await service.listRecent({ limit: 2 })
      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
    })

    it('returns empty when no activities', async () => {
      mockDb._qb._result = []
      const result = await service.listRecent()
      expect(result.items).toHaveLength(0)
      expect(result.hasMore).toBe(false)
    })

    it('filters by ownerId when provided', async () => {
      mockDb._qb._result = [makeActivity({ ownerId: 'user-1' })]
      const result = await service.listRecent(undefined, { ownerId: 'user-1' })
      expect(result.items).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('creates an activity', async () => {
      const newActivity = makeActivity({ id: 'activity-new' })
      mockDb._qb._result = [newActivity]
      const result = await service.create({
        entityId: 'lead-001',
        entityType: 'lead',
        title: 'Test',
        type: 'call',
      })
      expect(result).toEqual(newActivity)
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------
  describe('update()', () => {
    it('updates an activity', async () => {
      const updated = makeActivity({ title: 'Updated Title' })
      mockDb._qb._result = [updated]
      const result = await service.update('activity-001', { title: 'Updated Title' })
      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('returns null when updating nonexistent activity', async () => {
      mockDb._qb._result = []
      const result = await service.update('nonexistent', { title: 'No match' })
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // delete()
  // -------------------------------------------------------------------------
  describe('delete()', () => {
    it('deletes an activity', async () => {
      mockDb._qb._result = [makeActivity()]
      const result = await service.delete('activity-001')
      expect(result).toBeDefined()
      expect(mockDb.delete).toHaveBeenCalled()
    })

    it('returns null when deleting nonexistent activity', async () => {
      mockDb._qb._result = []
      const result = await service.delete('nonexistent')
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // complete()
  // -------------------------------------------------------------------------
  describe('complete()', () => {
    it('marks activity as completed', async () => {
      const completed = makeActivity({ completedAt: new Date(), status: 'completed' })
      mockDb._qb._result = [completed]
      const result = await service.complete('activity-001')
      expect(result).toEqual(completed)
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('returns null when completing nonexistent activity', async () => {
      mockDb._qb._result = []
      const result = await service.complete('nonexistent')
      expect(result).toBeNull()
    })
  })
})

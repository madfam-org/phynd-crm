import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TagsService } from '../tags/tags.service'
import { type MockDatabase, createTestContext, makeTag } from './helpers'

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
}))

vi.mock('@phynd/db/schema', () => ({
  taggables: {
    entityId: 'taggables.entityId',
    entityType: 'taggables.entityType',
    id: 'taggables.id',
    tagId: 'taggables.tagId',
  },
  tags: {
    color: 'tags.color',
    createdAt: 'tags.createdAt',
    id: 'tags.id',
    name: 'tags.name',
  },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TagsService', () => {
  let service: TagsService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new TagsService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------
  describe('list()', () => {
    it('returns paginated tags with default limit', async () => {
      const items = [makeTag({ id: 'tag-001' }), makeTag({ id: 'tag-002', name: 'Premium' })]
      mockDb._qb._result = items

      const result = await service.list()

      expect(mockDb.select).toHaveBeenCalled()
      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })

    it('detects hasMore when rows exceed limit', async () => {
      const limit = 2
      const items = [
        makeTag({ id: 'tag-001' }),
        makeTag({ id: 'tag-002' }),
        makeTag({ id: 'tag-003' }), // overflow row
      ]
      mockDb._qb._result = items

      const result = await service.list({ limit })

      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
      expect(result.nextCursor).toBe('tag-002')
    })

    it('applies cursor for pagination', async () => {
      mockDb._qb._result = [makeTag({ id: 'tag-005' })]

      const result = await service.list({ cursor: 'tag-004', limit: 10 })

      expect(result.items).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns empty result when no tags exist', async () => {
      mockDb._qb._result = []

      const result = await service.list()

      expect(result.items).toHaveLength(0)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('creates a tag with name and color', async () => {
      const newTag = makeTag({ id: 'tag-new' })
      mockDb._qb._result = [newTag]

      const result = await service.create({ name: 'VIP', color: '#8b5cf6' })

      expect(result).toEqual(newTag)
      expect(mockDb.insert).toHaveBeenCalled()
      expect(mockDb._qb.values).toHaveBeenCalled()
      expect(mockDb._qb.returning).toHaveBeenCalled()
    })

    it('creates a tag without color', async () => {
      const newTag = makeTag({ color: undefined, id: 'tag-no-color' })
      mockDb._qb._result = [newTag]

      const result = await service.create({ name: 'Important' })

      expect(result).toEqual(newTag)
      const valuesArg = mockDb._qb.values.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(valuesArg?.name).toBe('Important')
    })
  })

  // -------------------------------------------------------------------------
  // delete()
  // -------------------------------------------------------------------------
  describe('delete()', () => {
    it('deletes a tag and returns it', async () => {
      const deleted = makeTag({ id: 'tag-001' })
      mockDb._qb._result = [deleted]

      const result = await service.delete('tag-001')

      expect(result).toEqual(deleted)
      expect(mockDb.delete).toHaveBeenCalled()
      expect(mockDb._qb.where).toHaveBeenCalled()
      expect(mockDb._qb.returning).toHaveBeenCalled()
    })

    it('returns null when deleting a nonexistent tag', async () => {
      mockDb._qb._result = []

      const result = await service.delete('nonexistent')

      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // addToEntity()
  // -------------------------------------------------------------------------
  describe('addToEntity()', () => {
    it('inserts a taggable record linking tag to entity', async () => {
      const taggable = {
        entityId: 'contact-001',
        entityType: 'contact',
        id: 'tg-001',
        tagId: 'tag-001',
      }
      mockDb._qb._result = [taggable]

      const result = await service.addToEntity('tag-001', 'contact', 'contact-001')

      expect(result).toEqual(taggable)
      expect(mockDb.insert).toHaveBeenCalled()
      expect(mockDb._qb.values).toHaveBeenCalled()
      expect(mockDb._qb.onConflictDoNothing).toHaveBeenCalled()
      expect(mockDb._qb.returning).toHaveBeenCalled()
    })

    it('returns null on conflict (duplicate tag assignment)', async () => {
      mockDb._qb._result = []

      const result = await service.addToEntity('tag-001', 'contact', 'contact-001')

      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // removeFromEntity()
  // -------------------------------------------------------------------------
  describe('removeFromEntity()', () => {
    it('removes the taggable record and returns it', async () => {
      const taggable = {
        entityId: 'contact-001',
        entityType: 'contact',
        id: 'tg-001',
        tagId: 'tag-001',
      }
      mockDb._qb._result = [taggable]

      const result = await service.removeFromEntity('tag-001', 'contact', 'contact-001')

      expect(result).toEqual(taggable)
      expect(mockDb.delete).toHaveBeenCalled()
      expect(mockDb._qb.where).toHaveBeenCalled()
      expect(mockDb._qb.returning).toHaveBeenCalled()
    })

    it('returns null when taggable does not exist', async () => {
      mockDb._qb._result = []

      const result = await service.removeFromEntity('tag-999', 'contact', 'contact-001')

      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // getForEntity()
  // -------------------------------------------------------------------------
  describe('getForEntity()', () => {
    it('returns tags joined to an entity via taggables', async () => {
      const items = [
        { color: '#8b5cf6', createdAt: new Date(), id: 'tag-001', name: 'VIP' },
        { color: '#ef4444', createdAt: new Date(), id: 'tag-002', name: 'Hot' },
      ]
      mockDb._qb._result = items

      const result = await service.getForEntity('contact', 'contact-001')

      expect(mockDb.select).toHaveBeenCalled()
      expect(mockDb._qb.from).toHaveBeenCalled()
      expect(mockDb._qb.innerJoin).toHaveBeenCalled()
      expect(mockDb._qb.where).toHaveBeenCalled()
      expect(result).toHaveLength(2)
    })

    it('returns empty array when entity has no tags', async () => {
      mockDb._qb._result = []

      const result = await service.getForEntity('lead', 'lead-999')

      expect(result).toHaveLength(0)
    })
  })
})

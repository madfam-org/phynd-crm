import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotesService } from '../notes/notes.service'
import { type MockDatabase, createTestContext, makeNote } from './helpers'

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
}))

vi.mock('@phyne/db/schema', () => ({
  notes: {
    createdAt: 'notes.createdAt',
    entityId: 'notes.entityId',
    entityType: 'notes.entityType',
    id: 'notes.id',
    isPinned: 'notes.isPinned',
  },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotesService', () => {
  let service: NotesService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new NotesService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // listForEntity()
  // -------------------------------------------------------------------------
  describe('listForEntity()', () => {
    it('returns notes for a given entity', async () => {
      const items = [
        makeNote({ id: 'note-001' }),
        makeNote({ id: 'note-002', content: 'Second note' }),
      ]
      mockDb._qb._result = items

      const result = await service.listForEntity('contact', 'entity-001')

      expect(mockDb.select).toHaveBeenCalled()
      expect(mockDb._qb.from).toHaveBeenCalled()
      expect(mockDb._qb.where).toHaveBeenCalled()
      expect(mockDb._qb.orderBy).toHaveBeenCalled()
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(items[0])
    })

    it('returns empty array when no notes exist', async () => {
      mockDb._qb._result = []

      const result = await service.listForEntity('lead', 'entity-999')

      expect(result).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('inserts a note with authorId from auth context', async () => {
      const newNote = makeNote({ id: 'note-new' })
      mockDb._qb._result = [newNote]

      const result = await service.create({
        content: 'Test note content',
        entityId: 'entity-001',
        entityType: 'contact',
      })

      expect(result).toEqual(newNote)
      expect(mockDb.insert).toHaveBeenCalled()
      expect(mockDb._qb.values).toHaveBeenCalled()
      // Verify values include authorId from context
      const valuesArg = mockDb._qb.values.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(valuesArg).toBeDefined()
      expect(valuesArg?.authorId).toBe('test-user')
    })

    it('creates a pinned note when isPinned is provided', async () => {
      const pinnedNote = makeNote({ id: 'note-pinned', isPinned: true })
      mockDb._qb._result = [pinnedNote]

      const result = await service.create({
        content: 'Important note',
        entityId: 'entity-001',
        entityType: 'contact',
        isPinned: true,
      })

      expect(result).toEqual(pinnedNote)
      const valuesArg = mockDb._qb.values.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(valuesArg?.isPinned).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------
  describe('update()', () => {
    it('updates note content and sets updatedAt', async () => {
      const updated = makeNote({ content: 'Updated content', id: 'note-001' })
      mockDb._qb._result = [updated]

      const result = await service.update('note-001', { content: 'Updated content' })

      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb._qb.set).toHaveBeenCalled()
      const setArg = mockDb._qb.set.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(setArg).toBeDefined()
      expect(setArg?.content).toBe('Updated content')
      expect(setArg?.updatedAt).toBeInstanceOf(Date)
    })

    it('returns null when updating a nonexistent note', async () => {
      mockDb._qb._result = []

      const result = await service.update('nonexistent', { content: 'nope' })

      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // delete()
  // -------------------------------------------------------------------------
  describe('delete()', () => {
    it('performs a hard delete and returns the deleted note', async () => {
      const deleted = makeNote({ id: 'note-001' })
      mockDb._qb._result = [deleted]

      const result = await service.delete('note-001')

      expect(result).toEqual(deleted)
      expect(mockDb.delete).toHaveBeenCalled()
      expect(mockDb._qb.where).toHaveBeenCalled()
      expect(mockDb._qb.returning).toHaveBeenCalled()
    })

    it('returns null when deleting a nonexistent note', async () => {
      mockDb._qb._result = []

      const result = await service.delete('nonexistent')

      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // togglePin()
  // -------------------------------------------------------------------------
  describe('togglePin()', () => {
    it('flips isPinned from false to true', async () => {
      const existing = makeNote({ id: 'note-001', isPinned: false })
      const toggled = makeNote({ id: 'note-001', isPinned: true })

      // First call: select returns existing note; second call: update returns toggled
      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve([existing]).then(resolve)
        }
        return Promise.resolve([toggled]).then(resolve)
      })

      const result = await service.togglePin('note-001')

      expect(result).toEqual(toggled)
      expect(mockDb.update).toHaveBeenCalled()
      const setArg = mockDb._qb.set.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(setArg?.isPinned).toBe(true)
    })

    it('flips isPinned from true to false', async () => {
      const existing = makeNote({ id: 'note-001', isPinned: true })
      const toggled = makeNote({ id: 'note-001', isPinned: false })

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve([existing]).then(resolve)
        }
        return Promise.resolve([toggled]).then(resolve)
      })

      const result = await service.togglePin('note-001')

      expect(result).toEqual(toggled)
      const setArg = mockDb._qb.set.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(setArg?.isPinned).toBe(false)
    })

    it('returns null when note does not exist', async () => {
      mockDb._qb._result = []

      const result = await service.togglePin('nonexistent')

      expect(result).toBeNull()
      expect(mockDb.update).not.toHaveBeenCalled()
    })
  })
})

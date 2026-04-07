import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactsService } from '../contacts/contacts.service'
import { type MockDatabase, createTestContext, makeContact } from './helpers'

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

vi.mock('@phyne/db/schema', () => ({
  contacts: {
    deletedAt: 'contacts.deletedAt',
    externalJanuaId: 'contacts.externalJanuaId',
    id: 'contacts.id',
    name: 'contacts.name',
    ownerId: 'contacts.ownerId',
  },
}))

describe('ContactsService', () => {
  let service: ContactsService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new ContactsService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------
  describe('list()', () => {
    it('returns paginated contacts', async () => {
      mockDb._qb._result = [makeContact()]
      const result = await service.list()
      expect(result.items).toHaveLength(1)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })

    it('detects hasMore when rows exceed limit', async () => {
      mockDb._qb._result = [
        makeContact({ id: 'c1' }),
        makeContact({ id: 'c2' }),
        makeContact({ id: 'c3' }),
      ]
      const result = await service.list({ limit: 2 })
      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
    })

    it('returns empty when no contacts', async () => {
      mockDb._qb._result = []
      const result = await service.list()
      expect(result.items).toHaveLength(0)
      expect(result.hasMore).toBe(false)
    })

    it('applies cursor for pagination', async () => {
      mockDb._qb._result = [makeContact({ id: 'c5' })]
      const result = await service.list({ cursor: 'c4', limit: 10 })
      expect(result.items).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('filters by ownerId when provided', async () => {
      mockDb._qb._result = [makeContact({ ownerId: 'user-1' })]
      const result = await service.list(undefined, { ownerId: 'user-1' })
      expect(result.items).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // getById()
  // -------------------------------------------------------------------------
  describe('getById()', () => {
    it('returns a contact when found', async () => {
      const contact = makeContact()
      mockDb._qb._result = [contact]
      const result = await service.getById('contact-001')
      expect(result).toEqual(contact)
    })

    it('returns null when not found', async () => {
      mockDb._qb._result = []
      const result = await service.getById('nonexistent')
      expect(result).toBeNull()
    })

    it('filters by non-deleted contacts (soft delete)', async () => {
      mockDb._qb._result = []
      await service.getById('contact-deleted')
      expect(mockDb._qb.where).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // getByJanuaId()
  // -------------------------------------------------------------------------
  describe('getByJanuaId()', () => {
    it('returns a contact by Janua ID', async () => {
      const contact = makeContact({ externalJanuaId: 'janua-123' })
      mockDb._qb._result = [contact]
      const result = await service.getByJanuaId('janua-123')
      expect(result).toEqual(contact)
    })

    it('returns null when no contact matches Janua ID', async () => {
      mockDb._qb._result = []
      const result = await service.getByJanuaId('nonexistent')
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // getByName()
  // -------------------------------------------------------------------------
  describe('getByName()', () => {
    it('returns a contact by name', async () => {
      const contact = makeContact({ name: 'u/testuser' })
      mockDb._qb._result = [contact]
      const result = await service.getByName('u/testuser')
      expect(result).toEqual(contact)
    })

    it('returns null when no contact matches name', async () => {
      mockDb._qb._result = []
      const result = await service.getByName('u/nonexistent')
      expect(result).toBeNull()
    })

    it('filters by non-deleted contacts (soft delete)', async () => {
      mockDb._qb._result = []
      await service.getByName('u/deleted-user')
      expect(mockDb._qb.where).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('creates a contact', async () => {
      const newContact = makeContact({ id: 'new' })
      mockDb._qb._result = [newContact]
      const result = await service.create({ email: 'jane@example.com', name: 'Jane' })
      expect(result).toEqual(newContact)
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------
  describe('update()', () => {
    it('updates a contact', async () => {
      const updated = makeContact({ name: 'Updated' })
      mockDb._qb._result = [updated]
      const result = await service.update('contact-001', { name: 'Updated' })
      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('returns null when updating nonexistent contact', async () => {
      mockDb._qb._result = []
      const result = await service.update('nonexistent', { name: 'Updated' })
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // delete() — soft delete
  // -------------------------------------------------------------------------
  describe('delete()', () => {
    it('performs a soft delete', async () => {
      const deleted = makeContact({ deletedAt: new Date() })
      mockDb._qb._result = [deleted]
      const result = await service.delete('contact-001')
      expect(result).toEqual(deleted)
      expect(mockDb.update).toHaveBeenCalled()
      const setArg = mockDb._qb.set.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(setArg?.deletedAt).toBeInstanceOf(Date)
    })

    it('returns null when deleting nonexistent contact', async () => {
      mockDb._qb._result = []
      const result = await service.delete('nonexistent')
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // bulkCreate()
  // -------------------------------------------------------------------------
  describe('bulkCreate()', () => {
    it('creates multiple contacts', async () => {
      const contacts = [
        makeContact({ id: 'c1', name: 'Alice' }),
        makeContact({ id: 'c2', name: 'Bob' }),
      ]
      mockDb._qb._result = contacts

      const result = await service.bulkCreate([
        { email: 'alice@example.com', name: 'Alice' },
        { email: 'bob@example.com', name: 'Bob' },
      ])

      expect(result).toHaveLength(2)
      expect(result[0]?.name).toBe('Alice')
      expect(result[1]?.name).toBe('Bob')
    })

    it('returns empty array for empty input', async () => {
      const result = await service.bulkCreate([])

      expect(result).toEqual([])
      expect(mockDb.transaction).not.toHaveBeenCalled()
    })

    it('creates with optional fields', async () => {
      const contact = makeContact({
        company: 'Acme',
        id: 'c3',
        name: 'Carol',
        ownerId: 'user-1',
        phone: '+1234567890',
      })
      mockDb._qb._result = [contact]

      const result = await service.bulkCreate([
        {
          company: 'Acme',
          name: 'Carol',
          ownerId: 'user-1',
          phone: '+1234567890',
        },
      ])

      expect(result).toHaveLength(1)
      expect(result[0]?.company).toBe('Acme')
      expect(result[0]?.ownerId).toBe('user-1')
    })

    it('calls transaction for non-empty input', async () => {
      mockDb._qb._result = [makeContact()]

      await service.bulkCreate([{ name: 'Test' }])

      expect(mockDb.transaction).toHaveBeenCalledTimes(1)
    })
  })
})

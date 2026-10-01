import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError, NotFoundError } from '../errors'
import { crmUserResolver } from '../identity/crm-user-resolver'
import { UsersService } from '../users/users.service'
import { type MockDatabase, createTestContext, makeUser } from './helpers'

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
  users: {
    email: 'users.email',
    externalJanuaId: 'users.externalJanuaId',
    id: 'users.id',
    name: 'users.name',
    role: 'users.role',
  },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UsersService', () => {
  let service: UsersService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new UsersService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  /** Resolves the next awaited queries, in order, to these rows. */
  function queueResults(...results: unknown[][]) {
    for (const rows of results) {
      mockDb._qb.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
        Promise.resolve(rows).then(resolve),
      )
    }
  }

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------
  describe('list()', () => {
    it('returns paginated users with default limit', async () => {
      const items = [makeUser({ id: 'user-001' }), makeUser({ id: 'user-002', name: 'Jane' })]
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
        makeUser({ id: 'user-001' }),
        makeUser({ id: 'user-002' }),
        makeUser({ id: 'user-003' }), // overflow row
      ]
      mockDb._qb._result = items

      const result = await service.list({ limit })

      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
      expect(result.nextCursor).toBe('user-002')
    })

    it('applies cursor for pagination', async () => {
      mockDb._qb._result = [makeUser({ id: 'user-005' })]

      const result = await service.list({ cursor: 'user-004', limit: 10 })

      expect(result.items).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns empty result when no users exist', async () => {
      mockDb._qb._result = []

      const result = await service.list()

      expect(result.items).toHaveLength(0)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // getById()
  // -------------------------------------------------------------------------
  describe('getById()', () => {
    it('returns a user when found', async () => {
      const user = makeUser({ id: 'user-123' })
      mockDb._qb._result = [user]

      const result = await service.getById('user-123')

      expect(result).toEqual(user)
      expect(mockDb.select).toHaveBeenCalled()
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns null when user not found', async () => {
      mockDb._qb._result = []

      const result = await service.getById('nonexistent')

      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // getByJanuaId()
  // -------------------------------------------------------------------------
  describe('getByJanuaId()', () => {
    it('returns a user by external Janua ID', async () => {
      const user = makeUser({ externalJanuaId: 'janua-abc', id: 'user-001' })
      mockDb._qb._result = [user]

      const result = await service.getByJanuaId('janua-abc')

      expect(result).toEqual(user)
      expect(mockDb.select).toHaveBeenCalled()
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns null when no user matches Janua ID', async () => {
      mockDb._qb._result = []

      const result = await service.getByJanuaId('janua-unknown')

      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('creates a user with email', async () => {
      const newUser = makeUser({ id: 'user-new' })
      mockDb._qb._result = [newUser]

      const result = await service.create({ email: 'test@example.com' })

      expect(result).toEqual(newUser)
      expect(mockDb.insert).toHaveBeenCalled()
      expect(mockDb._qb.values).toHaveBeenCalled()
      expect(mockDb._qb.returning).toHaveBeenCalled()
    })

    it('creates a user with all optional fields', async () => {
      const newUser = makeUser({
        email: 'admin@example.com',
        externalJanuaId: 'janua-123',
        id: 'user-admin',
        name: 'Admin User',
        role: 'admin',
      })
      queueResults([], [newUser]) // Janua id is free, then the insert

      const result = await service.create({
        email: 'admin@example.com',
        externalJanuaId: 'janua-123',
        name: 'Admin User',
        role: 'admin',
      })

      expect(result).toEqual(newUser)
      const valuesArg = mockDb._qb.values.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(valuesArg?.email).toBe('admin@example.com')
      expect(valuesArg?.name).toBe('Admin User')
      expect(valuesArg?.role).toBe('admin')
      expect(valuesArg?.externalJanuaId).toBe('janua-123')
    })

    it('rejects a Janua id already linked to another user', async () => {
      queueResults([makeUser({ id: 'user-other', externalJanuaId: 'janua-123' })])

      await expect(
        service.create({ email: 'new@example.com', externalJanuaId: 'janua-123' }),
      ).rejects.toBeInstanceOf(ConflictError)
      expect(mockDb.insert).not.toHaveBeenCalled()
    })

    it('reports a unique violation from a concurrent insert as a conflict', async () => {
      queueResults([])
      mockDb._qb.then.mockImplementationOnce((_resolve: unknown, reject: (e: unknown) => void) =>
        reject(Object.assign(new Error('query failed'), { cause: { code: '23505' } })),
      )

      await expect(
        service.create({ email: 'new@example.com', externalJanuaId: 'janua-123' }),
      ).rejects.toThrow('already linked to another CRM user')
    })

    it('treats an empty Janua id as no link and skips the check', async () => {
      const newUser = makeUser({ id: 'user-new' })
      mockDb._qb._result = [newUser]

      await service.create({ email: 'new@example.com', externalJanuaId: '' })

      expect(mockDb.select).not.toHaveBeenCalled()
      const valuesArg = mockDb._qb.values.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(valuesArg?.externalJanuaId).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // linkJanua() / unlinkJanua()
  // -------------------------------------------------------------------------
  describe('linkJanua()', () => {
    it('links an unlinked user and invalidates the resolver cache', async () => {
      const invalidate = vi.spyOn(crmUserResolver, 'invalidate')
      const linked = makeUser({ id: 'user-001', externalJanuaId: 'janua-sub-1' })
      queueResults([makeUser({ id: 'user-001', externalJanuaId: null })], [], [linked])

      const result = await service.linkJanua('user-001', 'janua-sub-1')

      expect(result).toEqual(linked)
      const setArg = mockDb._qb.set.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(setArg).toEqual({ externalJanuaId: 'janua-sub-1' })
      expect(invalidate).toHaveBeenCalledWith('madfam', 'janua-sub-1')
    })

    it('is idempotent for the same pair', async () => {
      const user = makeUser({ id: 'user-001', externalJanuaId: 'janua-sub-1' })
      queueResults([user])

      await expect(service.linkJanua('user-001', 'janua-sub-1')).resolves.toEqual(user)
      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('refuses to relink a user that holds another Janua id', async () => {
      queueResults([makeUser({ id: 'user-001', externalJanuaId: 'janua-sub-old' })])

      await expect(service.linkJanua('user-001', 'janua-sub-1')).rejects.toThrow(
        'already linked to a different Janua identity',
      )
      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('refuses a Janua id linked to another user', async () => {
      queueResults(
        [makeUser({ id: 'user-001', externalJanuaId: null })],
        [makeUser({ id: 'user-002', externalJanuaId: 'janua-sub-1' })],
      )

      const err = await service.linkJanua('user-001', 'janua-sub-1').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ConflictError)
      expect((err as ConflictError).details).toEqual({ userId: 'user-002' })
      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('reports a concurrent link of the same user as a conflict', async () => {
      queueResults([makeUser({ id: 'user-001', externalJanuaId: null })], [], [])

      await expect(service.linkJanua('user-001', 'janua-sub-1')).rejects.toThrow(
        'linked concurrently',
      )
    })

    it('throws NotFoundError for an unknown user', async () => {
      queueResults([])

      await expect(service.linkJanua('missing', 'janua-sub-1')).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })
  })

  describe('unlinkJanua()', () => {
    it('clears the link and invalidates the previous subject', async () => {
      const invalidate = vi.spyOn(crmUserResolver, 'invalidate')
      const unlinked = makeUser({ id: 'user-001', externalJanuaId: null })
      queueResults([makeUser({ id: 'user-001', externalJanuaId: 'janua-sub-1' })], [unlinked])

      const result = await service.unlinkJanua('user-001')

      expect(result).toEqual(unlinked)
      const setArg = mockDb._qb.set.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(setArg).toEqual({ externalJanuaId: null })
      expect(invalidate).toHaveBeenCalledWith('madfam', 'janua-sub-1')
    })

    it('is a no-op for a user that is not linked', async () => {
      const user = makeUser({ id: 'user-001', externalJanuaId: null })
      queueResults([user])

      await expect(service.unlinkJanua('user-001')).resolves.toEqual(user)
      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('throws NotFoundError for an unknown user', async () => {
      queueResults([])

      await expect(service.unlinkJanua('missing')).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------
  describe('update()', () => {
    it('updates a user and returns the updated record', async () => {
      const updated = makeUser({ id: 'user-001', name: 'Updated Name' })
      mockDb._qb._result = [updated]

      const result = await service.update('user-001', { name: 'Updated Name' })

      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
      expect(mockDb._qb.set).toHaveBeenCalled()
      expect(mockDb._qb.where).toHaveBeenCalled()
      expect(mockDb._qb.returning).toHaveBeenCalled()
    })

    it('returns null when updating a nonexistent user', async () => {
      mockDb._qb._result = []

      const result = await service.update('nonexistent', { name: 'nope' })

      expect(result).toBeNull()
    })

    it('updates user role', async () => {
      const updated = makeUser({ id: 'user-001', role: 'admin' })
      mockDb._qb._result = [updated]

      const result = await service.update('user-001', { role: 'admin' })

      expect(result).toEqual(updated)
      const setArg = mockDb._qb.set.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      expect(setArg?.role).toBe('admin')
    })
  })

  // -------------------------------------------------------------------------
  // delete() -- hard delete
  // -------------------------------------------------------------------------
  describe('delete()', () => {
    it('performs a hard delete and returns the deleted user', async () => {
      const deleted = makeUser({ id: 'user-001' })
      mockDb._qb._result = [deleted]

      const result = await service.delete('user-001')

      expect(result).toEqual(deleted)
      expect(mockDb.delete).toHaveBeenCalled()
      expect(mockDb._qb.where).toHaveBeenCalled()
      expect(mockDb._qb.returning).toHaveBeenCalled()
    })

    it('returns null when deleting a nonexistent user', async () => {
      mockDb._qb._result = []

      const result = await service.delete('nonexistent')

      expect(result).toBeNull()
    })
  })
})

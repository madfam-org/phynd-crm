import type { AuthContext } from '@phynd/types/auth'
import { CRM_USER_NOT_LINKED } from '@phynd/types/auth'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActivitiesService } from '../activities/activities.service'
import { CrmUserNotLinkedError } from '../errors'
import { actorIdOf, requireCrmUserId } from '../identity/actor'
import { CrmUserResolver } from '../identity/crm-user-resolver'
import { NotesService } from '../notes/notes.service'
import { NotificationsService } from '../notifications/notifications.service'
import { createMockDb, createTestContext } from './helpers'

const SUB = '5b0f2c1e-7a7d-4c1e-9d55-2f3b8f6a9c01'
const CRM_USER = 'crm-user-0001'

function janua(crmUserId: string | null): Partial<AuthContext> {
  return { userId: SUB, januaSub: SUB, crmUserId }
}

describe('requireCrmUserId', () => {
  it('returns the linked CRM user id for a Janua session', () => {
    expect(requireCrmUserId({ ...base(), ...janua(CRM_USER) })).toBe(CRM_USER)
  })

  it('throws the typed not-linked error for an unlinked Janua session', () => {
    const err = (() => {
      try {
        requireCrmUserId({ ...base(), ...janua(null) })
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(CrmUserNotLinkedError)
    expect((err as CrmUserNotLinkedError).code).toBe(CRM_USER_NOT_LINKED)
  })

  it('treats a Janua session whose link was never resolved as unlinked', () => {
    expect(() => requireCrmUserId({ ...base(), userId: SUB, januaSub: SUB })).toThrow(
      CrmUserNotLinkedError,
    )
  })

  it.each(['service:selva', 'system', 'service:email-drip', 'demo-abc', 'dev-user'])(
    'keeps the fixed id of the non-Janua principal %s',
    (userId) => {
      expect(requireCrmUserId({ ...base(), userId })).toBe(userId)
    },
  )
})

describe('actorIdOf', () => {
  it('prefers the linked CRM user id', () => {
    expect(actorIdOf({ ...base(), ...janua(CRM_USER) })).toBe(CRM_USER)
  })

  it('falls back to the Janua subject when unlinked, without throwing', () => {
    expect(actorIdOf({ ...base(), ...janua(null) })).toBe(SUB)
  })

  it('uses the principal id for service and system actors', () => {
    expect(actorIdOf({ ...base(), userId: 'service:selva' })).toBe('service:selva')
    expect(actorIdOf({ ...base(), userId: 'system' })).toBe('system')
  })
})

describe('CrmUserResolver', () => {
  function lookupDb(rows: Array<{ id: string }>) {
    return createMockDb(rows)
  }

  it('resolves the user linked through external_janua_id', async () => {
    const resolver = new CrmUserResolver()
    const db = lookupDb([{ id: CRM_USER }])

    await expect(resolver.resolve(db as never, 'madfam', SUB)).resolves.toBe(CRM_USER)
    expect(db.select).toHaveBeenCalledTimes(1)
    expect(db._qb.limit).toHaveBeenCalledWith(1)
  })

  it('returns null for an unlinked subject', async () => {
    const resolver = new CrmUserResolver()
    await expect(resolver.resolve(lookupDb([]) as never, 'madfam', SUB)).resolves.toBeNull()
  })

  it('serves repeated lookups from the cache within the TTL, including "not linked"', async () => {
    let now = 1_000
    const resolver = new CrmUserResolver({ ttlMs: 30_000, now: () => now })
    const linkedDb = lookupDb([{ id: CRM_USER }])
    const unlinkedDb = lookupDb([])

    await resolver.resolve(linkedDb as never, 'madfam', SUB)
    await resolver.resolve(unlinkedDb as never, 'madfam', 'other-sub')
    now += 29_999
    await expect(resolver.resolve(linkedDb as never, 'madfam', SUB)).resolves.toBe(CRM_USER)
    await expect(resolver.resolve(unlinkedDb as never, 'madfam', 'other-sub')).resolves.toBeNull()

    expect(linkedDb.select).toHaveBeenCalledTimes(1)
    expect(unlinkedDb.select).toHaveBeenCalledTimes(1)
  })

  it('asks the database again once the entry expires', async () => {
    let now = 0
    const resolver = new CrmUserResolver({ ttlMs: 30_000, now: () => now })
    const db = lookupDb([])
    await resolver.resolve(db as never, 'madfam', SUB)
    db._qb._result = [{ id: CRM_USER }]
    now += 30_000

    await expect(resolver.resolve(db as never, 'madfam', SUB)).resolves.toBe(CRM_USER)
    expect(db.select).toHaveBeenCalledTimes(2)
  })

  it('invalidate() forces a fresh lookup for that subject', async () => {
    const resolver = new CrmUserResolver()
    const db = lookupDb([])
    await resolver.resolve(db as never, 'madfam', SUB)
    db._qb._result = [{ id: CRM_USER }]
    resolver.invalidate('madfam', SUB)

    await expect(resolver.resolve(db as never, 'madfam', SUB)).resolves.toBe(CRM_USER)
  })

  it('keys the cache by tenant as well as subject', async () => {
    const resolver = new CrmUserResolver()
    await resolver.resolve(lookupDb([{ id: CRM_USER }]) as never, 'madfam', SUB)

    const otherTenant = lookupDb([])
    await expect(resolver.resolve(otherTenant as never, 'tablaco', SUB)).resolves.toBeNull()
    expect(otherTenant.select).toHaveBeenCalledTimes(1)
  })

  it('stays bounded, evicting the oldest entry', async () => {
    const resolver = new CrmUserResolver({ maxEntries: 2 })
    const db = lookupDb([])
    await resolver.resolve(db as never, 'madfam', 'a')
    await resolver.resolve(db as never, 'madfam', 'b')
    await resolver.resolve(db as never, 'madfam', 'c')
    expect(resolver.size).toBe(2)

    await resolver.resolve(db as never, 'madfam', 'a')
    expect(db.select).toHaveBeenCalledTimes(4)
  })

  it('does not cache a failed lookup', async () => {
    const resolver = new CrmUserResolver()
    const db = lookupDb([])
    db._qb.then.mockImplementationOnce((_resolve: unknown, reject: (e: unknown) => void) =>
      reject(new Error('db down')),
    )

    await expect(resolver.resolve(db as never, 'madfam', SUB)).rejects.toThrow('db down')
    expect(resolver.size).toBe(0)
  })

  it('never queries for an empty subject', async () => {
    const resolver = new CrmUserResolver()
    const db = lookupDb([{ id: CRM_USER }])
    await expect(resolver.resolve(db as never, 'madfam', '')).resolves.toBeNull()
    expect(db.select).not.toHaveBeenCalled()
  })
})

describe('foreign-key writes use the linked CRM user', () => {
  afterEach(() => vi.clearAllMocks())

  it('ActivitiesService.create writes owner_id = crmUserId for a linked user', async () => {
    const ctx = createTestContext([], { auth: janua(CRM_USER) })
    ctx.mockDb._qb._result = [{ id: 'act-1' }]

    await new ActivitiesService(ctx).create({
      type: 'call',
      title: 'Intro call',
      entityType: 'lead',
      entityId: 'lead-1',
    })

    const values = ctx.mockDb._qb.values.mock.calls[0]?.[0] as Record<string, unknown>
    expect(values.ownerId).toBe(CRM_USER)
  })

  it('ActivitiesService.create refuses an unlinked Janua user before writing', async () => {
    const ctx = createTestContext([], { auth: janua(null) })

    await expect(
      new ActivitiesService(ctx).create({
        type: 'call',
        title: 'Intro call',
        entityType: 'lead',
        entityId: 'lead-1',
      }),
    ).rejects.toBeInstanceOf(CrmUserNotLinkedError)
    expect(ctx.mockDb.insert).not.toHaveBeenCalled()
  })

  it('NotesService.create records the actor by the convention (CRM user, else Janua sub)', async () => {
    const linked = createTestContext([], { auth: janua(CRM_USER) })
    linked.mockDb._qb._result = [{ id: 'note-1' }]
    await new NotesService(linked).create({ content: 'x', entityType: 'lead', entityId: 'lead-1' })
    expect((linked.mockDb._qb.values.mock.calls[0]?.[0] as Record<string, unknown>).authorId).toBe(
      CRM_USER,
    )

    const unlinked = createTestContext([], { auth: janua(null) })
    unlinked.mockDb._qb._result = [{ id: 'note-2' }]
    await new NotesService(unlinked).create({
      content: 'x',
      entityType: 'lead',
      entityId: 'lead-1',
    })
    expect(
      (unlinked.mockDb._qb.values.mock.calls[0]?.[0] as Record<string, unknown>).authorId,
    ).toBe(SUB)
  })

  it('NotificationsService.markAsRead only matches the given user when one is passed', async () => {
    const ctx = createTestContext([], { auth: janua(CRM_USER) })
    ctx.mockDb._qb._result = []
    await new NotificationsService(ctx).markAsRead('n-1', CRM_USER)
    const where = ctx.mockDb._qb.where.mock.calls[0]?.[0] as SQL
    const { sql, params } = new PgDialect().sqlToQuery(where)
    expect(sql).toContain('"user_id"')
    expect(params).toEqual(['n-1', CRM_USER])
  })
})

function base(): AuthContext {
  return { userId: '', tenantId: 'madfam', roles: [], scopes: [], accessToken: '' }
}

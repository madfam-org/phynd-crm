import { describe, expect, it, vi } from 'vitest'

vi.mock('@phynd/db/schema', () => ({ users: { id: 'users.id' } }))
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}))

import {
  DEFAULT_TASK_OWNER_ENV,
  DEFAULT_TASK_OWNER_UNAVAILABLE,
  resolveSystemTaskOwner,
} from '../system-task-owner'

/** A handle whose `users` table holds `ids`; records each looked-up id. */
function fakeDb(ids: string[]) {
  const lookedUp: string[] = []
  const db = {
    select: () => ({
      from: () => ({
        where: (condition: { val: string }) => ({
          limit: async () => {
            lookedUp.push(condition.val)
            return ids.includes(condition.val) ? [{ id: condition.val }] : []
          },
        }),
      }),
    }),
  }
  return { db: db as unknown as Parameters<typeof resolveSystemTaskOwner>[0], lookedUp }
}

function logger() {
  return { warn: vi.fn() }
}

describe('resolveSystemTaskOwner', () => {
  it("keeps the contact's owner without reading the configuration", async () => {
    const { db, lookedUp } = fakeDb(['user-default'])
    const log = logger()
    const owner = await resolveSystemTaskOwner(db, log, {
      contactOwnerId: 'user-owner',
      env: { [DEFAULT_TASK_OWNER_ENV]: 'user-default' },
    })
    expect(owner).toBe('user-owner')
    expect(lookedUp).toEqual([])
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('returns the configured default when it names an existing user', async () => {
    const { db, lookedUp } = fakeDb(['user-default'])
    const log = logger()
    const owner = await resolveSystemTaskOwner(db, log, {
      contactOwnerId: null,
      env: { [DEFAULT_TASK_OWNER_ENV]: '  user-default\n' },
    })
    expect(owner).toBe('user-default')
    expect(lookedUp).toEqual(['user-default'])
    expect(log.warn).not.toHaveBeenCalled()
  })

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('returns null and warns once when the default is %s', async (_label, value) => {
    const { db, lookedUp } = fakeDb(['user-default'])
    const log = logger()
    const owner = await resolveSystemTaskOwner(db, log, {
      contactOwnerId: undefined,
      env: { [DEFAULT_TASK_OWNER_ENV]: value },
      logContext: { lead_id: 'lead-1' },
    })
    expect(owner).toBeNull()
    expect(lookedUp).toEqual([])
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: DEFAULT_TASK_OWNER_UNAVAILABLE,
        reason: 'unset',
        lead_id: 'lead-1',
      }),
      expect.stringMatching(/^DEFAULT_TASK_OWNER_UNAVAILABLE: /),
    )
  })

  it('returns null and warns once when the default names no user, without logging the id', async () => {
    const { db } = fakeDb([])
    const log = logger()
    const owner = await resolveSystemTaskOwner(db, log, {
      contactOwnerId: null,
      env: { [DEFAULT_TASK_OWNER_ENV]: 'user-gone' },
    })
    expect(owner).toBeNull()
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0]?.[0]).toMatchObject({ reason: 'unknown_user' })
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('user-gone')
  })

  it('does not look up an over-long value', async () => {
    const { db, lookedUp } = fakeDb([])
    const log = logger()
    const owner = await resolveSystemTaskOwner(db, log, {
      contactOwnerId: null,
      env: { [DEFAULT_TASK_OWNER_ENV]: 'x'.repeat(256) },
    })
    expect(owner).toBeNull()
    expect(lookedUp).toEqual([])
    expect(log.warn.mock.calls[0]?.[0]).toMatchObject({ reason: 'unknown_user' })
  })
})

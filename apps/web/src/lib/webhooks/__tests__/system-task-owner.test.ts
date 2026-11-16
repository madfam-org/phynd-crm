import { describe, expect, it, vi } from 'vitest'

vi.mock('@phynd/db/schema', () => ({
  users: { id: 'users.id', externalJanuaId: 'users.externalJanuaId' },
}))
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}))

import {
  DEFAULT_TASK_OWNER_ENV,
  DEFAULT_TASK_OWNER_UNAVAILABLE,
  resolveSystemTaskOwner,
} from '../system-task-owner'

/**
 * A handle whose `users` table holds `ids`, plus users linked to Janua
 * subjects (`subjects`: subject → user id); records each looked-up value and
 * the column it was looked up by.
 */
function fakeDb(ids: string[], subjects: Record<string, string> = {}) {
  const lookedUp: string[] = []
  const columns: string[] = []
  const rowsFor = ({ col, val }: { col: string; val: string }) => {
    lookedUp.push(val)
    columns.push(col)
    const id = col === 'users.externalJanuaId' ? subjects[val] : ids.find((known) => known === val)
    return id ? [{ id }] : []
  }
  const db = {
    select: () => ({
      from: () => ({
        where: (condition: { col: string; val: string }) => ({
          limit: async () => rowsFor(condition),
        }),
      }),
    }),
  }
  return { db: db as unknown as Parameters<typeof resolveSystemTaskOwner>[0], lookedUp, columns }
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

  it('resolves the janua:<subject> form to the linked CRM user', async () => {
    const { db, lookedUp, columns } = fakeDb([], { 'subject-op': 'user-linked' })
    const log = logger()
    const owner = await resolveSystemTaskOwner(db, log, {
      contactOwnerId: null,
      env: { [DEFAULT_TASK_OWNER_ENV]: ' janua:subject-op ' },
    })
    expect(owner).toBe('user-linked')
    expect(lookedUp).toEqual(['subject-op'])
    expect(columns).toEqual(['users.externalJanuaId'])
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('keeps plain ids looked up by users.id, never by subject', async () => {
    const { db, columns } = fakeDb(['user-default'], { 'user-default': 'someone-else' })
    const owner = await resolveSystemTaskOwner(db, logger(), {
      contactOwnerId: null,
      env: { [DEFAULT_TASK_OWNER_ENV]: 'user-default' },
    })
    expect(owner).toBe('user-default')
    expect(columns).toEqual(['users.id'])
  })

  it('returns null and warns once when no CRM user is linked to the subject, without logging it', async () => {
    const { db } = fakeDb(['subject-unlinked'])
    const log = logger()
    const owner = await resolveSystemTaskOwner(db, log, {
      contactOwnerId: null,
      env: { [DEFAULT_TASK_OWNER_ENV]: 'janua:subject-unlinked' },
      logContext: { lead_id: 'lead-2' },
    })
    expect(owner).toBeNull()
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0]?.[0]).toMatchObject({
      code: DEFAULT_TASK_OWNER_UNAVAILABLE,
      reason: 'unknown_user',
      lead_id: 'lead-2',
    })
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('subject-unlinked')
  })

  it.each([
    ['empty', 'janua:'],
    ['blank', 'janua:   '],
    ['over-long', `janua:${'s'.repeat(256)}`],
  ])('does not look up a %s subject and warns once', async (_label, value) => {
    const { db, lookedUp } = fakeDb([])
    const log = logger()
    const owner = await resolveSystemTaskOwner(db, log, {
      contactOwnerId: null,
      env: { [DEFAULT_TASK_OWNER_ENV]: value },
    })
    expect(owner).toBeNull()
    expect(lookedUp).toEqual([])
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0]?.[0]).toMatchObject({ reason: 'unknown_user' })
  })
})

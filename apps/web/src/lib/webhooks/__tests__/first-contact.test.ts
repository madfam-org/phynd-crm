import { describe, expect, it, vi } from 'vitest'

vi.mock('@phynd/db/schema', () => ({
  users: { id: 'users.id', externalJanuaId: 'users.externalJanuaId' },
}))
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}))

const mockCreateActivity = vi.fn()
vi.mock('@phynd/services', () => ({
  withTransaction: (ctx: Record<string, unknown>, tx: unknown) => ({ ...ctx, db: tx }),
  ActivitiesService: vi.fn().mockImplementation((ctx: { db: unknown }) => ({
    create: (data: unknown) => mockCreateActivity(ctx.db, data),
  })),
}))

import type { ServiceContext } from '@phynd/services'
import {
  FIRST_CONTACT_TITLE_PREFIX,
  firstContactTitle,
  openFirstContactTask,
  resolveIntakeLeadOwner,
} from '../first-contact'

function usersDb(ids: string[]) {
  return {
    select: () => ({
      from: () => ({
        where: ({ val }: { val: string }) => ({
          limit: async () => (ids.includes(val) ? [{ id: val }] : []),
        }),
      }),
    }),
  } as unknown as Parameters<typeof resolveIntakeLeadOwner>[0]
}

/** A context whose `db.transaction` runs the callback on a savepoint handle. */
function txContext() {
  const savepoint = { savepoint: true }
  const db = {
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(savepoint)),
  }
  return { ctx: { db } as unknown as ServiceContext, db, savepoint }
}

describe('firstContactTitle', () => {
  it('prefixes the subject and fits activities.title', () => {
    expect(firstContactTitle('Lead Uno')).toBe(`${FIRST_CONTACT_TITLE_PREFIX}: Lead Uno`)
    const long = firstContactTitle('ñ'.repeat(400))
    expect(Array.from(long)).toHaveLength(255)
    expect(long.startsWith('Primer contacto: ')).toBe(true)
  })
})

describe('resolveIntakeLeadOwner', () => {
  it("keeps the contact's owner", async () => {
    const warn = vi.fn()
    const owner = await resolveIntakeLeadOwner(
      usersDb([]),
      { warn },
      {
        contactOwnerId: 'user-owner',
        source: 'avala',
        contactId: 'contact-1',
        env: {},
      },
    )
    expect(owner).toBe('user-owner')
    expect(warn).not.toHaveBeenCalled()
  })

  it('uses the configured default owner when it names a CRM user', async () => {
    const owner = await resolveIntakeLeadOwner(
      usersDb(['user-default']),
      { warn: vi.fn() },
      {
        contactOwnerId: null,
        source: 'nauta',
        contactId: 'contact-1',
        env: { PHYND_CRM_DEFAULT_TASK_OWNER_ID: 'user-default' },
      },
    )
    expect(owner).toBe('user-default')
  })

  it('returns null and warns once, with identifiers only, when there is no default', async () => {
    const warn = vi.fn()
    const owner = await resolveIntakeLeadOwner(
      usersDb([]),
      { warn },
      {
        contactOwnerId: null,
        source: 'kalya',
        contactId: 'contact-1',
        env: {},
      },
    )
    expect(owner).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toEqual({
      task: 'lead_first_contact',
      source: 'kalya',
      contact_id: 'contact-1',
      code: 'DEFAULT_TASK_OWNER_UNAVAILABLE',
      reason: 'unset',
      env: 'PHYND_CRM_DEFAULT_TASK_OWNER_ID',
    })
  })
})

describe('openFirstContactTask', () => {
  it('opens a pending task on the lead in a savepoint, due the next business day', async () => {
    mockCreateActivity.mockReset().mockResolvedValue({ id: 'activity-1' })
    const { ctx, db, savepoint } = txContext()
    // Wednesday 2026-11-25, 12:00 Mexico City
    const now = new Date('2026-11-25T18:00:00.000Z')

    const dueAt = await openFirstContactTask(
      ctx,
      { warn: vi.fn() },
      {
        leadId: 'lead-1',
        ownerId: 'user-default',
        subject: 'Lead Uno',
        description: 'Lead por formulario de Avala.',
        now,
      },
    )

    expect(dueAt?.toISOString()).toBe('2026-11-26T15:00:00.000Z')
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(mockCreateActivity).toHaveBeenCalledWith(savepoint, {
      type: 'task',
      title: 'Primer contacto: Lead Uno',
      description: 'Lead por formulario de Avala.',
      dueAt,
      entityType: 'lead',
      entityId: 'lead-1',
      ownerId: 'user-default',
    })
  })

  it('keeps an unassigned task unassigned (null, never the caller)', async () => {
    mockCreateActivity.mockReset().mockResolvedValue({ id: 'activity-1' })
    const { ctx } = txContext()
    await openFirstContactTask(
      ctx,
      { warn: vi.fn() },
      {
        leadId: 'lead-1',
        ownerId: null,
        subject: 'Lead Uno',
        description: 'x',
      },
    )
    expect((mockCreateActivity.mock.calls[0]?.[1] as { ownerId: unknown }).ownerId).toBeNull()
  })

  it('returns null and logs when the task cannot be written', async () => {
    mockCreateActivity.mockReset().mockRejectedValue(new Error('insert failed'))
    const { ctx } = txContext()
    const warn = vi.fn()
    const dueAt = await openFirstContactTask(
      ctx,
      { warn },
      {
        leadId: 'lead-1',
        ownerId: null,
        subject: 'Lead Uno',
        description: 'x',
      },
    )
    expect(dueAt).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead-1' }),
      'first-contact task not created',
    )
  })
})

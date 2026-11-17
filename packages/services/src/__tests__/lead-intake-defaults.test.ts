import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyLeadIntakeDefaults,
  firstContactTitle,
  nextBusinessDayDueAt,
} from '../leads/lead-intake-defaults'
import { type MockDatabase, createTestContext } from './helpers'

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

vi.mock('@phynd/db/schema', () => ({
  activities: {
    id: 'activities.id',
    entityId: 'activities.entityId',
    entityType: 'activities.entityType',
    kind: 'activities.kind',
  },
  leads: { id: 'leads.id', ownerId: 'leads.ownerId' },
}))

function feed(db: MockDatabase, responses: unknown[][]) {
  db._qb.then.mockImplementation((resolve: (v: unknown) => void) =>
    Promise.resolve(responses.shift() ?? []).then(resolve),
  )
}

describe('nextBusinessDayDueAt', () => {
  it('is 09:00 Mexico City the next weekday', () => {
    // Friday 2026-11-20 18:00 Mexico City → Monday 2026-11-23 09:00 (15:00 UTC).
    expect(nextBusinessDayDueAt(new Date('2026-11-21T00:00:00Z')).toISOString()).toBe(
      '2026-11-23T15:00:00.000Z',
    )
    // Tuesday → Wednesday.
    expect(nextBusinessDayDueAt(new Date('2026-11-17T17:00:00Z')).toISOString()).toBe(
      '2026-11-18T15:00:00.000Z',
    )
  })
})

describe('applyLeadIntakeDefaults', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('sets the owner only where there is none and opens the first-contact task', async () => {
    const { mockDb } = createTestContext()
    feed(mockDb, [[], [{ ownerId: 'user-default' }], [], [{ id: 'task-1' }]])

    const result = await applyLeadIntakeDefaults(
      { db: mockDb as never },
      {
        leadId: 'lead-1',
        ownerId: 'user-default',
        displayName: 'Persona Ficticia',
        now: new Date('2026-11-17T17:00:00Z'),
      },
    )

    expect(result).toEqual({
      ownerId: 'user-default',
      taskId: 'task-1',
      dueAt: new Date('2026-11-18T15:00:00.000Z'),
    })
    expect(JSON.stringify(mockDb._qb.where.mock.calls[0])).toContain(
      '"_tag":"isNull","col":"leads.ownerId"',
    )
    expect(mockDb._qb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task',
        kind: 'first_contact',
        title: 'First contact: Persona Ficticia',
        entityType: 'lead',
        entityId: 'lead-1',
        ownerId: 'user-default',
      }),
    )
  })

  it('opens no second task (idempotent)', async () => {
    const { mockDb } = createTestContext()
    feed(mockDb, [[{ ownerId: 'user-x' }], [{ id: 'task-existing' }]])
    const result = await applyLeadIntakeDefaults(
      { db: mockDb as never },
      { leadId: 'lead-1', ownerId: null },
    )
    expect(result).toEqual({ ownerId: 'user-x', taskId: null, dueAt: null })
    expect(mockDb.insert).not.toHaveBeenCalled()
    expect(mockDb.update).not.toHaveBeenCalled()
  })

  it('cuts a long title to the column', () => {
    expect(Array.from(firstContactTitle('x'.repeat(400)))).toHaveLength(255)
    expect(firstContactTitle(null)).toBe('First contact')
  })
})

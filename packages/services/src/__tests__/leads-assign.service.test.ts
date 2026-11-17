import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../errors'
import { LeadsService } from '../leads/leads.service'
import { type MockDatabase, createTestContext, makeLead } from './helpers'

vi.mock('@phynd/config/features', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  asc: vi.fn((col: unknown) => ({ _tag: 'asc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  inArray: vi.fn((col: unknown, val: unknown) => ({ _tag: 'inArray', col, val })),
  isNotNull: vi.fn((col: unknown) => ({ _tag: 'isNotNull', col })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

vi.mock('@phynd/db/schema', () => ({
  activities: {
    entityId: 'activities.entityId',
    entityType: 'activities.entityType',
    kind: 'activities.kind',
    status: 'activities.status',
  },
  conversions: { id: 'conversions.id' },
  leads: {
    deletedAt: 'leads.deletedAt',
    id: 'leads.id',
    isTest: 'leads.isTest',
    ownerId: 'leads.ownerId',
    tier: 'leads.tier',
  },
  notifications: { id: 'notifications.id' },
  stageTransitions: { id: 'stageTransitions.id' },
  users: {
    email: 'users.email',
    externalJanuaId: 'users.externalJanuaId',
    id: 'users.id',
    name: 'users.name',
    role: 'users.role',
  },
}))

/** Answers the queries in order; later queries get `[]`. */
function feed(db: MockDatabase, responses: unknown[][]) {
  db._qb.then.mockImplementation((resolve: (v: unknown) => void) =>
    Promise.resolve(responses.shift() ?? []).then(resolve),
  )
}

describe('LeadsService.assign', () => {
  let service: LeadsService
  let db: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext([], { auth: { crmUserId: 'user-actor' } })
    db = ctx.mockDb
    service = new LeadsService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('moves the owner and the open first-contact task, writes a timeline entry, notifies', async () => {
    const lead = makeLead({ id: 'lead-001', ownerId: 'user-old' })
    feed(db, [
      [lead], // getById
      [{ id: 'user-new', name: 'Persona Nueva', email: 'nueva@empresa-ficticia.mx' }], // assignee
      [{ name: 'Persona Anterior', email: 'anterior@empresa-ficticia.mx' }], // previous owner
      [{ ...lead, ownerId: 'user-new' }], // update lead returning
      [], // update task
      [], // insert timeline activity
      [{ id: 'notification-001' }], // notification
    ])

    const result = await service.assign('lead-001', 'user-new')

    expect(result).toEqual(expect.objectContaining({ ownerId: 'user-new' }))
    const sets = db._qb.set.mock.calls.map((call) => call[0])
    // Lead owner, then the open first-contact task.
    expect(sets).toEqual([{ ownerId: 'user-new' }, { ownerId: 'user-new' }])
    const taskFilter = JSON.stringify(db._qb.where.mock.calls)
    expect(taskFilter).toContain('activities.kind')
    expect(taskFilter).toContain('first_contact')
    expect(taskFilter).toContain('pending')

    const inserted = db._qb.values.mock.calls.map((call) => call[0] as Record<string, unknown>)
    expect(inserted[0]).toEqual(
      expect.objectContaining({
        type: 'note',
        status: 'completed',
        title: 'Lead assigned to Persona Nueva',
        description: 'Previous owner: Persona Anterior.',
        entityType: 'lead',
        entityId: 'lead-001',
        ownerId: 'user-actor',
      }),
    )
    expect(inserted[1]).toEqual(
      expect.objectContaining({
        userId: 'user-new',
        type: 'owner_assignment',
        entityId: 'lead-001',
      }),
    )
  })

  it('refuses a user who cannot own leads (viewer, unlinked or unknown)', async () => {
    feed(db, [[makeLead({ id: 'lead-001' })], []])
    await expect(service.assign('lead-001', 'user-viewer')).rejects.toBeInstanceOf(ValidationError)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('changes nothing when the lead already has that owner', async () => {
    const lead = makeLead({ id: 'lead-001', ownerId: 'user-new' })
    feed(db, [[lead], [{ id: 'user-new', name: null, email: 'nueva@empresa-ficticia.mx' }]])
    const result = await service.assign('lead-001', 'user-new')
    expect(result).toEqual(lead)
    expect(db.update).not.toHaveBeenCalled()
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('does not notify the person who assigned the lead to themselves', async () => {
    const lead = makeLead({ id: 'lead-001', ownerId: null })
    feed(db, [
      [lead],
      [{ id: 'user-actor', name: 'Yo', email: 'yo@empresa-ficticia.mx' }],
      [{ ...lead, ownerId: 'user-actor' }],
      [],
      [],
    ])
    await service.assign('lead-001', 'user-actor')
    const inserted = db._qb.values.mock.calls.map((call) => call[0] as Record<string, unknown>)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toEqual(
      expect.objectContaining({ description: 'Previous owner: unassigned.' }),
    )
  })
})

describe('LeadsService.list filters', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('leaves test leads out and filters by tier and unassigned', async () => {
    const ctx = createTestContext([])
    const service = new LeadsService(ctx)
    await service.list(undefined, { unassigned: true, tier: 'A' })
    const where = JSON.stringify(ctx.mockDb._qb.where.mock.calls[0])
    expect(where).toContain('"_tag":"isNull","col":"leads.ownerId"')
    expect(where).toContain('"col":"leads.tier","val":"A"')
    expect(where).toContain('"col":"leads.isTest","val":false')
  })

  it('includes test leads only when asked', async () => {
    const ctx = createTestContext([])
    const service = new LeadsService(ctx)
    await service.list(undefined, { includeTest: true, ownerId: 'user-1' })
    const where = JSON.stringify(ctx.mockDb._qb.where.mock.calls[0])
    expect(where).not.toContain('leads.isTest')
    expect(where).toContain('"col":"leads.ownerId","val":"user-1"')
  })
})

describe('LeadsService.listAssignees', () => {
  it('offers staff roles that work leads, with a linked account', async () => {
    const ctx = createTestContext([
      { id: 'user-1', name: 'Persona', email: 'p@empresa-ficticia.mx', role: 'sales_rep' },
    ])
    const service = new LeadsService(ctx)
    const rows = await service.listAssignees()
    expect(rows).toHaveLength(1)
    const where = JSON.stringify(ctx.mockDb._qb.where.mock.calls[0])
    expect(where).toContain('"col":"users.role","val":["admin","manager","sales_rep"]')
    expect(where).toContain('"_tag":"isNotNull","col":"users.externalJanuaId"')
  })
})

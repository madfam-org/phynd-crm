/**
 * The tenant store on the CRM's services: contacts, leads, notes and
 * activities go through the services (mocked here, tested on their own); the
 * lock, the processed-event record and the pick link are plain queries,
 * recorded by a fake database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@phynd/db/schema', () => {
  const table = (name: string, cols: string[]) => {
    const t: Record<string, string> = { _table: name }
    for (const c of cols) t[c] = `${name}.${c}`
    return t
  }
  return {
    contacts: table('contacts', ['id']),
    leads: table('leads', ['id']),
    users: table('users', ['id', 'externalJanuaId']),
    externalReferences: table('external_references', [
      'id',
      'entityType',
      'entityId',
      'provider',
      'externalId',
      'externalType',
      'metadata',
    ]),
    webhookEvents: table('webhook_events', ['id', 'provider', 'payload']),
  }
})

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: strings.join('?'),
    values,
  }),
}))

const services = vi.hoisted(() => ({
  contactsCreate: vi.fn(),
  contactsUpdate: vi.fn(),
  contactsGetById: vi.fn(),
  leadsCreate: vi.fn(),
  leadsGetById: vi.fn(),
  leadsUpdateAttribution: vi.fn(),
  notesCreate: vi.fn(),
  notesList: vi.fn(),
  notesUpdate: vi.fn(),
  activitiesCreate: vi.fn(),
  activitiesComplete: vi.fn(),
  getDefault: vi.fn(),
  getStages: vi.fn(),
  contexts: [] as unknown[],
}))

vi.mock('../contacts/contacts.service', () => ({
  ContactsService: vi.fn().mockImplementation(() => ({
    create: services.contactsCreate,
    update: services.contactsUpdate,
    getById: services.contactsGetById,
  })),
}))
vi.mock('../leads/leads.service', () => ({
  LeadsService: vi.fn().mockImplementation(() => ({
    create: services.leadsCreate,
    getById: services.leadsGetById,
    updateAttribution: services.leadsUpdateAttribution,
  })),
}))
vi.mock('../notes/notes.service', () => ({
  NotesService: vi.fn().mockImplementation(() => ({
    create: services.notesCreate,
    listForEntity: services.notesList,
    update: services.notesUpdate,
  })),
}))
vi.mock('../activities/activities.service', () => ({
  ActivitiesService: vi.fn().mockImplementation((ctx: unknown) => {
    services.contexts.push(ctx)
    return { create: services.activitiesCreate, complete: services.activitiesComplete }
  }),
}))
vi.mock('../pipelines/pipelines.service', () => ({
  PipelinesService: vi.fn().mockImplementation(() => ({
    getDefault: services.getDefault,
    getStages: services.getStages,
  })),
}))

import { CENSUS_ACTOR_ID } from '../census/census-handoff'
import { createCensusTenantStore } from '../census/census-tenant-store'

type Op = { op: string; table?: string; values?: unknown; set?: unknown; where?: unknown }

function fakeDb(selectResults: unknown[][] = []) {
  const ops: Op[] = []
  const db: Record<string, unknown> = {}
  const chain = (result: unknown, record: Op) => {
    const builder: Record<string, unknown> = {}
    const capture: Record<string, (arg: unknown) => void> = {
      from: (arg) => {
        record.table = (arg as { _table: string })._table
      },
      where: (arg) => {
        record.where = arg
      },
      set: (arg) => {
        record.set = arg
      },
      values: (arg) => {
        record.values = arg
      },
    }
    for (const method of ['from', 'where', 'limit', 'set', 'values', 'returning']) {
      builder[method] = (arg: unknown) => {
        capture[method]?.(arg)
        return builder
      }
    }
    // biome-ignore lint/suspicious/noThenProperty: an awaitable query builder
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return builder
  }
  db.execute = vi.fn(async (query: unknown) => {
    ops.push({ op: 'execute', values: query })
  })
  db.select = vi.fn(() => {
    const record: Op = { op: 'select' }
    ops.push(record)
    return chain(selectResults.shift() ?? [], record)
  })
  db.insert = vi.fn((table: { _table: string }) => {
    const record: Op = { op: 'insert', table: table._table }
    ops.push(record)
    return chain([], record)
  })
  db.update = vi.fn((table: { _table: string }) => {
    const record: Op = { op: 'update', table: table._table }
    ops.push(record)
    return chain([], record)
  })
  db.delete = vi.fn((table: { _table: string }) => {
    const record: Op = { op: 'delete', table: table._table }
    ops.push(record)
    return chain([], record)
  })
  db.transaction = vi.fn(async (work: (tx: unknown) => unknown) => work(db))
  return { db, ops }
}

const logger = { warn: vi.fn() }

function store(db: Record<string, unknown>, env: Record<string, string | undefined> = {}) {
  return createCensusTenantStore({
    // biome-ignore lint/suspicious/noExplicitAny: a fake database
    db: db as any,
    // biome-ignore lint/suspicious/noExplicitAny: a fake cache
    cache: {} as any,
    tenantId: 'agency_a',
    logger,
    env,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  services.contexts.length = 0
})

describe('createCensusTenantStore', () => {
  it('runs everything in one transaction, as the census service principal', async () => {
    const { db } = fakeDb()
    services.activitiesCreate.mockResolvedValue({ id: 'act-1' })
    await store(db).run(async (tx) => {
      await tx.recordLeadActivity({ leadId: 'lead-1', title: 't', description: 'd' })
    })
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(services.contexts[0]).toMatchObject({
      tenantId: 'agency_a',
      auth: { userId: CENSUS_ACTOR_ID, roles: ['service'] },
    })
  })

  it('records a processed event without channel data and finds it by event id', async () => {
    const { db, ops } = fakeDb([[{ id: 'we-1' }]])
    await store(db).run(async (tx) => {
      expect(await tx.hasProcessedEvent('evt-1')).toBe(true)
      await tx.recordProcessedEvent({
        eventId: 'evt-1',
        eventType: 'census.pick.handed_off',
        summary: { list_id: 'list-1', stage: 'shortlisted' },
      })
    })
    expect(ops[0]).toMatchObject({ op: 'select', table: 'webhook_events' })
    expect(JSON.stringify(ops[0]?.where)).toContain('evt-1')
    expect(ops[1]).toMatchObject({
      op: 'insert',
      table: 'webhook_events',
      values: {
        provider: 'creator-census',
        eventType: 'census.pick.handed_off',
        payload: { list_id: 'list-1', stage: 'shortlisted', event_id: 'evt-1' },
      },
    })
  })

  it('stores a pick link as an external reference and updates it in place', async () => {
    const { db, ops } = fakeDb()
    await store(db).run(async (tx) => {
      await tx.saveLink({
        orgId: 'org-1',
        listId: 'list-1',
        platform: 'youtube',
        externalId: 'UCx',
        leadId: 'lead-1',
        contactId: 'contact-1',
      })
      await tx.saveLink({
        id: 'ref-1',
        orgId: 'org-1',
        listId: 'list-2',
        platform: 'youtube',
        externalId: 'UCx',
        leadId: 'lead-2',
        contactId: 'contact-1',
      })
    })
    expect(ops[0]).toMatchObject({
      op: 'insert',
      table: 'external_references',
      values: {
        entityType: 'lead',
        entityId: 'lead-1',
        provider: 'creator-census',
        externalId: 'youtube:UCx',
        externalType: 'census_pick',
        metadata: { org_id: 'org-1', list_id: 'list-1', contact_id: 'contact-1' },
      },
    })
    expect(ops[1]).toMatchObject({
      op: 'update',
      table: 'external_references',
      set: {
        entityId: 'lead-2',
        metadata: { org_id: 'org-1', list_id: 'list-2', contact_id: 'contact-1' },
      },
    })
  })

  it('opens the lead in the default pipeline first stage through the services', async () => {
    services.getDefault.mockResolvedValue({ id: 'pipe-1' })
    services.getStages.mockResolvedValue([{ id: 'stage-1' }, { id: 'stage-2' }])
    services.leadsCreate.mockResolvedValue({ id: 'lead-9' })
    const { db } = fakeDb()
    const result = await store(db).run((tx) =>
      tx.createLeadInDefaultPipeline({
        contactId: 'contact-1',
        source: 'creator-census',
        attribution: { census: { stage: 'shortlisted' } },
      }),
    )
    expect(result).toEqual({ id: 'lead-9' })
    expect(services.leadsCreate).toHaveBeenCalledWith({
      contactId: 'contact-1',
      source: 'creator-census',
      attribution: { census: { stage: 'shortlisted' } },
      pipelineId: 'pipe-1',
      stageId: 'stage-1',
    })
  })

  it('returns null without a default pipeline', async () => {
    services.getDefault.mockResolvedValue(null)
    const { db } = fakeDb()
    const result = await store(db).run((tx) =>
      tx.createLeadInDefaultPipeline({ contactId: 'c', source: 's', attribution: {} }),
    )
    expect(result).toBeNull()
    expect(services.leadsCreate).not.toHaveBeenCalled()
  })

  it('assigns the follow-up task to the configured default task owner', async () => {
    // users lookup for the configured owner
    const { db } = fakeDb([[{ id: 'crm-user-7' }]])
    services.activitiesCreate.mockResolvedValue({ id: 'act-1' })
    const due = new Date('2026-11-25T15:00:00Z')
    const created = await store(db, { PHYND_CRM_DEFAULT_TASK_OWNER_ID: 'crm-user-7' }).run((tx) =>
      tx.openFollowUpTask({
        leadId: 'lead-1',
        contactOwnerId: null,
        title: 'Dar seguimiento',
        description: 'd',
        dueAt: due,
      }),
    )
    expect(created).toBe(true)
    expect(services.activitiesCreate).toHaveBeenCalledWith({
      type: 'task',
      title: 'Dar seguimiento',
      description: 'd',
      dueAt: due,
      entityType: 'lead',
      entityId: 'lead-1',
      ownerId: 'crm-user-7',
    })
  })

  it('leaves the task unassigned with the usual warning when no default owner is set', async () => {
    const { db } = fakeDb()
    services.activitiesCreate.mockResolvedValue({ id: 'act-1' })
    await store(db, {}).run((tx) =>
      tx.openFollowUpTask({
        leadId: 'lead-1',
        contactOwnerId: null,
        title: 't',
        description: 'd',
        dueAt: new Date(),
      }),
    )
    expect(services.activitiesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: null }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DEFAULT_TASK_OWNER_UNAVAILABLE', reason: 'unset' }),
      expect.any(String),
    )
  })

  it('keeps going when the task fails (best effort)', async () => {
    const { db } = fakeDb()
    services.activitiesCreate.mockRejectedValue(new Error('constraint'))
    const created = await store(db).run((tx) =>
      tx.openFollowUpTask({
        leadId: 'lead-1',
        contactOwnerId: 'owner-1',
        title: 't',
        description: 'd',
        dueAt: new Date(),
      }),
    )
    expect(created).toBe(false)
  })

  it('records a finished, unowned activity', async () => {
    const { db } = fakeDb()
    services.activitiesCreate.mockResolvedValue({ id: 'act-5' })
    await store(db).run((tx) =>
      tx.recordLeadActivity({ leadId: 'lead-1', title: 'Etapa', description: 'd' }),
    )
    expect(services.activitiesCreate).toHaveBeenCalledWith({
      type: 'note',
      title: 'Etapa',
      description: 'd',
      entityType: 'lead',
      entityId: 'lead-1',
      ownerId: null,
    })
    expect(services.activitiesComplete).toHaveBeenCalledWith('act-5')
  })

  it('lists only the notes the census wrote', async () => {
    services.notesList.mockResolvedValue([
      { id: 'n1', content: 'census', authorId: CENSUS_ACTOR_ID },
      { id: 'n2', content: 'staff', authorId: 'crm-user-1' },
    ])
    const { db } = fakeDb()
    const notes = await store(db).run((tx) => tx.listCensusNotes('lead-1'))
    expect(services.notesList).toHaveBeenCalledWith('lead', 'lead-1')
    expect(notes).toEqual([{ id: 'n1', content: 'census' }])
  })
})

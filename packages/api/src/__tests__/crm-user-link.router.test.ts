/**
 * Janua identity → CRM user link at the tRPC layer (docs/IDENTITY.md).
 *
 * - Per-user reads and owner foreign-key writes use `ctx.auth.crmUserId`.
 * - An unlinked Janua identity gets PRECONDITION_FAILED with the Spanish
 *   user-facing message and `data.appCode = 'CRM_USER_NOT_LINKED'`.
 * - Service principals keep their fixed id.
 * - Admins link and unlink users; conflicts surface as CONFLICT.
 */
import {
  ActivitiesService,
  ContactsService,
  LeadsService,
  NotificationsService,
  UsersService,
} from '@phynd/services'
import type { ServiceContext } from '@phynd/services/context'
import { ConflictError } from '@phynd/services/errors'
import type { AuthContext } from '@phynd/types/auth'
import { CRM_USER_NOT_LINKED, CRM_USER_NOT_LINKED_MESSAGE } from '@phynd/types/auth'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appRouter } from '../router'
import { createCallerFactory } from '../trpc'

const SUB = '5b0f2c1e-7a7d-4c1e-9d55-2f3b8f6a9c01'
const CRM_USER = '0d6f9e2a-1111-4b2c-8c3d-000000000001'

const linked: Partial<AuthContext> = { userId: SUB, januaSub: SUB, crmUserId: CRM_USER }
const unlinked: Partial<AuthContext> = { userId: SUB, januaSub: SUB, crmUserId: null }

function createMockCtx(authOverrides: Partial<AuthContext> = {}): ServiceContext {
  const qb: Record<string, unknown> & { _result: unknown[] } = { _result: [] }
  for (const m of [
    'delete',
    'from',
    'groupBy',
    'innerJoin',
    'insert',
    'leftJoin',
    'limit',
    'onConflictDoNothing',
    'orderBy',
    'returning',
    'select',
    'set',
    'update',
    'values',
    'where',
  ]) {
    qb[m] = vi.fn(() => qb)
  }
  Object.defineProperty(qb, 'then', {
    value: (resolve: (v: unknown) => void) => Promise.resolve(qb._result).then(resolve),
  })
  const db = {
    delete: vi.fn(() => qb),
    insert: vi.fn(() => qb),
    select: vi.fn(() => qb),
    update: vi.fn(() => qb),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
  }
  return {
    auth: {
      accessToken: 'tok',
      roles: ['admin'],
      scopes: ['*'],
      tenantId: 'madfam',
      userId: 'user-001',
      ...authOverrides,
    },
    cache: {} as ServiceContext['cache'],
    db: db as unknown as ServiceContext['db'],
    tenantId: 'madfam',
  }
}

const createCaller = createCallerFactory(appRouter)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('per-user reads use the linked CRM user', () => {
  it('leads.listMine scopes to crmUserId for a linked Janua user', async () => {
    const list = vi
      .spyOn(LeadsService.prototype, 'list')
      .mockResolvedValue({ items: [], nextCursor: null, hasMore: false })

    await createCaller(createMockCtx(linked)).leads.listMine()

    expect(list).toHaveBeenCalledWith(undefined, { ownerId: CRM_USER })
  })

  it('leads.listMine fails with the typed not-linked error for an unlinked user', async () => {
    const list = vi.spyOn(LeadsService.prototype, 'list')

    await expect(createCaller(createMockCtx(unlinked)).leads.listMine()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: CRM_USER_NOT_LINKED_MESSAGE,
    })
    expect(list).not.toHaveBeenCalled()
  })

  it('notifications use crmUserId and refuse an unlinked user', async () => {
    const count = vi.spyOn(NotificationsService.prototype, 'getUnreadCount').mockResolvedValue(3)
    const markAsRead = vi
      .spyOn(NotificationsService.prototype, 'markAsRead')
      .mockResolvedValue(null)

    await expect(createCaller(createMockCtx(linked)).notifications.unreadCount()).resolves.toBe(3)
    expect(count).toHaveBeenCalledWith(CRM_USER)
    const id = '00000000-0000-4000-8000-000000000001'
    await createCaller(createMockCtx(linked)).notifications.markAsRead({ id })
    expect(markAsRead).toHaveBeenCalledWith(id, CRM_USER)

    await expect(
      createCaller(createMockCtx(unlinked)).notifications.unreadCount(),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
  })

  it('a service principal keeps its fixed id (no Janua subject)', async () => {
    const list = vi
      .spyOn(LeadsService.prototype, 'list')
      .mockResolvedValue({ items: [], nextCursor: null, hasMore: false })
    const ctx = createMockCtx({
      userId: 'service:selva',
      roles: ['service'],
      scopes: ['leads:read'],
    })

    await createCaller(ctx).leads.listMine()

    expect(list).toHaveBeenCalledWith(undefined, { ownerId: 'service:selva' })
  })

  it('reads that need no CRM user keep working for an unlinked user', async () => {
    vi.spyOn(LeadsService.prototype, 'list').mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    })
    await expect(createCaller(createMockCtx(unlinked)).leads.list()).resolves.toMatchObject({
      items: [],
    })
  })
})

describe('owner foreign-key writes use the linked CRM user', () => {
  it('contacts.bulkCreate stamps owner_id = crmUserId', async () => {
    const bulk = vi.spyOn(ContactsService.prototype, 'bulkCreate').mockResolvedValue([] as never)

    await createCaller(createMockCtx(linked)).contacts.bulkCreate([{ name: 'A' }, { name: 'B' }])

    expect(bulk).toHaveBeenCalledWith([
      { name: 'A', ownerId: CRM_USER },
      { name: 'B', ownerId: CRM_USER },
    ])
  })

  it('contacts.bulkCreate refuses an unlinked user before writing', async () => {
    const bulk = vi.spyOn(ContactsService.prototype, 'bulkCreate')

    await expect(
      createCaller(createMockCtx(unlinked)).contacts.bulkCreate([{ name: 'A' }]),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(bulk).not.toHaveBeenCalled()
  })

  it('activities.create writes owner_id = crmUserId for a linked user', async () => {
    const ctx = createMockCtx(linked)
    const db = ctx.db as unknown as { insert: ReturnType<typeof vi.fn> }
    const qb = db.insert() as { values: ReturnType<typeof vi.fn>; _result: unknown[] }
    qb._result = [{ id: 'act-1' }]
    db.insert.mockClear()

    await createCaller(ctx).activities.create({
      type: 'call',
      title: 'Intro',
      entityType: 'lead',
      entityId: '00000000-0000-4000-8000-000000000002',
    })

    expect(qb.values).toHaveBeenCalledWith(expect.objectContaining({ ownerId: CRM_USER }))
  })

  it('activities.create fails with the typed error for an unlinked user', async () => {
    const create = vi.spyOn(ActivitiesService.prototype, 'create')

    await expect(
      createCaller(createMockCtx(unlinked)).activities.create({
        type: 'call',
        title: 'Intro',
        entityType: 'lead',
        entityId: '00000000-0000-4000-8000-000000000002',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: CRM_USER_NOT_LINKED_MESSAGE })
    expect(create).toHaveBeenCalled()
  })
})

describe('over HTTP the error carries a stable code for the UI', () => {
  it('returns 412 with data.appCode and the Spanish message', async () => {
    const res = await fetchRequestHandler({
      endpoint: '/api/trpc',
      req: new Request('http://crm.test/api/trpc/leads.listMine'),
      router: appRouter,
      createContext: () => createMockCtx(unlinked),
    })
    const body = (await res.json()) as {
      error: { json: { message: string; data: { appCode?: string; httpStatus: number } } }
    }

    expect(res.status).toBe(412)
    expect(body.error.json.message).toBe(CRM_USER_NOT_LINKED_MESSAGE)
    expect(body.error.json.data.appCode).toBe(CRM_USER_NOT_LINKED)
  })
})

describe('admin linking', () => {
  const id = '0d6f9e2a-1111-4b2c-8c3d-000000000002'

  it.each(['linkJanua', 'unlinkJanua'] as const)('%s is admin-only', async (proc) => {
    const caller = createCaller(createMockCtx({ ...linked, roles: ['sales_rep'] }))
    const input = proc === 'linkJanua' ? { id, januaSub: SUB } : { id }
    await expect(
      (caller.users[proc] as (i: typeof input) => Promise<unknown>)(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('linkJanua passes the trimmed subject to the service', async () => {
    const link = vi
      .spyOn(UsersService.prototype, 'linkJanua')
      .mockResolvedValue({ id, externalJanuaId: SUB } as never)

    await createCaller(createMockCtx(linked)).users.linkJanua({ id, januaSub: `  ${SUB} ` })

    expect(link).toHaveBeenCalledWith(id, SUB)
  })

  it('linkJanua reports a conflict clearly', async () => {
    vi.spyOn(UsersService.prototype, 'linkJanua').mockRejectedValue(
      new ConflictError('This Janua identity is already linked to another CRM user.'),
    )

    await expect(
      createCaller(createMockCtx(linked)).users.linkJanua({ id, januaSub: SUB }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'This Janua identity is already linked to another CRM user.',
    })
  })

  it.each(['service:selva', 'system', 'demo-abc', 'dev-user', 'has space', ''])(
    'linkJanua rejects %j as a Janua subject',
    async (januaSub) => {
      const link = vi.spyOn(UsersService.prototype, 'linkJanua')
      await expect(
        createCaller(createMockCtx(linked)).users.linkJanua({ id, januaSub }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      expect(link).not.toHaveBeenCalled()
    },
  )

  it('unlinkJanua calls the service', async () => {
    const unlink = vi
      .spyOn(UsersService.prototype, 'unlinkJanua')
      .mockResolvedValue({ id, externalJanuaId: null } as never)

    await createCaller(createMockCtx(linked)).users.unlinkJanua({ id })

    expect(unlink).toHaveBeenCalledWith(id)
  })

  it('create accepts and stores externalJanuaId', async () => {
    const create = vi
      .spyOn(UsersService.prototype, 'create')
      .mockResolvedValue({ id, externalJanuaId: SUB } as never)

    await createCaller(createMockCtx(linked)).users.create({
      email: 'new@example.com',
      externalJanuaId: SUB,
    })

    expect(create).toHaveBeenCalledWith({ email: 'new@example.com', externalJanuaId: SUB })
  })

  it('me reports the caller identity to any signed-in user', async () => {
    const caller = createCaller(createMockCtx({ ...unlinked, roles: ['viewer'] }))
    await expect(caller.users.me()).resolves.toEqual({
      januaSub: SUB,
      crmUserId: null,
      linked: false,
    })
  })
})

import {
  ENGAGEMENT_ITEM_KINDS,
  ENGAGEMENT_ITEM_SIDES,
  ENGAGEMENT_ITEM_STATUSES,
} from '@phynd/db/schema'
import type { ServiceContext } from '@phynd/services/context'
import type { AuthContext } from '@phynd/types/auth'
import { describe, expect, it, vi } from 'vitest'
import { appRouter } from '../router'
import { ENGAGEMENT_ITEM_INPUT_ENUMS } from '../routers/engagement-items'
import { createCallerFactory } from '../trpc'

vi.mock('@phynd/config/features', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}))

const createCaller = createCallerFactory(appRouter)

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    accessToken: 'tok_test',
    roles: ['admin'],
    scopes: ['*'],
    tenantId: 'madfam',
    userId: 'user-001',
    ...overrides,
  }
}

/** Every query resolves to the queue's next result; writes are recorded. */
function ctxWith(results: unknown[][], authOverrides: Partial<AuthContext> = {}) {
  const writes: Array<{ op: string; values: unknown }> = []
  let call = 0
  const builder = (): Record<string, unknown> => {
    const qb: Record<string, unknown> = {}
    for (const m of ['from', 'where', 'limit', 'orderBy', 'innerJoin', 'leftJoin']) {
      qb[m] = vi.fn(() => qb)
    }
    // biome-ignore lint/suspicious/noThenProperty: awaitable query-builder stub
    qb.then = (resolve: (v: unknown) => void) =>
      Promise.resolve(results[call++] ?? []).then(resolve)
    return qb
  }
  const db = {
    select: vi.fn(() => builder()),
    insert: vi.fn(() => ({
      values: (values: unknown) => {
        writes.push({ op: 'insert', values })
        return { returning: async () => [{ id: 'new', ...(values as object) }] }
      },
    })),
    update: vi.fn(() => ({
      set: (values: unknown) => {
        writes.push({ op: 'update', values })
        return { where: () => ({ returning: async () => [{ id: 'c1', ...(values as object) }] }) }
      },
    })),
    delete: vi.fn(),
    transaction: vi.fn(),
  }
  const ctx = {
    auth: auth(authOverrides),
    cache: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), invalidate: vi.fn() },
    db,
    tenantId: 'madfam',
  } as unknown as ServiceContext
  return { ctx, writes }
}

describe('engagementItems router', () => {
  it('accepts exactly the values the database CHECK constraints allow', () => {
    expect([...ENGAGEMENT_ITEM_INPUT_ENUMS.kinds]).toEqual([...ENGAGEMENT_ITEM_KINDS])
    expect([...ENGAGEMENT_ITEM_INPUT_ENUMS.statuses]).toEqual([...ENGAGEMENT_ITEM_STATUSES])
    expect([...ENGAGEMENT_ITEM_INPUT_ENUMS.sides]).toEqual([...ENGAGEMENT_ITEM_SIDES])
  })

  it('creates an internal item for staff', async () => {
    const { ctx, writes } = ctxWith([[{ id: 'eng-1' }], [{ next: 0 }]])
    const row = await createCaller(ctx).engagementItems.create({
      engagementId: 'eng-1',
      kind: 'decision',
      side: 'client',
      title: '  Elegir proveedor (sintético)  ',
      dueAt: '2026-11-01' as unknown as Date,
    })
    expect(row.clientVisible).toBe(false)
    expect(writes[0]?.values).toMatchObject({
      kind: 'decision',
      side: 'client',
      title: 'Elegir proveedor (sintético)',
      dueAt: new Date('2026-11-01'),
    })
  })

  it('rejects invalid kinds, sides, statuses and keys before writing', async () => {
    const { ctx, writes } = ctxWith([[{ id: 'eng-1' }], [{ next: 0 }]])
    const caller = createCaller(ctx)
    const base = { engagementId: 'eng-1', title: 'X' }
    await expect(
      caller.engagementItems.create({ ...base, kind: 'task' as 'milestone' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      caller.engagementItems.create({ ...base, kind: 'actionable', side: 'vendor' as 'client' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      caller.engagementItems.create({
        ...base,
        kind: 'actionable',
        status: 'overdue' as 'planned',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      caller.engagementItems.create({ ...base, kind: 'actionable', externalKey: 'Has Spaces' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      caller.engagementItems.create({ ...base, kind: 'actionable', title: '   ' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(writes).toHaveLength(0)
  })

  it('is out of reach of a read-scoped service token', async () => {
    const service = { roles: ['service'], scopes: ['engagements:read'], userId: 'service:selva' }
    const { ctx, writes } = ctxWith([[{ id: 'eng-1' }]], service)
    const caller = createCaller(ctx)
    await expect(caller.engagementItems.list({ engagementId: 'eng-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      caller.engagementItems.create({ engagementId: 'eng-1', kind: 'milestone', title: 'X' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      caller.engagementContacts.upsert({ engagementId: 'eng-1', contactId: 'c1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(writes).toHaveLength(0)
  })
})

describe('contacts register fields', () => {
  it("accepts 'tu', 'usted' and null (not asked yet)", async () => {
    const { ctx, writes } = ctxWith([])
    const caller = createCaller(ctx)
    const id = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
    await caller.contacts.update({ id, spanishFormality: 'tu', preferredName: 'Per' })
    await caller.contacts.update({ id, spanishFormality: null })
    expect(writes.map((w) => w.values)).toEqual([
      { spanishFormality: 'tu', preferredName: 'Per' },
      { spanishFormality: null },
    ])
  })

  it('rejects any other register', async () => {
    const { ctx, writes } = ctxWith([])
    await expect(
      createCaller(ctx).contacts.update({
        id: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
        spanishFormality: 'vos' as 'tu',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(writes).toHaveLength(0)
  })
})

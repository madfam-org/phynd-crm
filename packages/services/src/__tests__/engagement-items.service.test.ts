import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  EngagementItemsService,
  completedAtFor,
} from '../engagement-items/engagement-items.service'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { createMockQueryBuilder, createTestContext } from './helpers'

const dialect = new PgDialect()
const render = (condition: unknown) => dialect.sqlToQuery(condition as SQL)

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    engagementId: 'eng-1',
    kind: 'actionable',
    title: 'Revisar propuesta (sintético)',
    description: null,
    status: 'planned',
    side: 'client',
    ownerUserId: null,
    dueAt: null,
    completedAt: null,
    clientVisible: false,
    artifactId: null,
    externalKey: null,
    sortOrder: 0,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  }
}

/** select() calls resolve to the given results in order; inserts/updates are captured. */
function sequence(ctx: ReturnType<typeof createTestContext>, results: unknown[][]) {
  let call = 0
  ctx.mockDb.select = (() =>
    createMockQueryBuilder(results[call++] ?? [])) as unknown as typeof ctx.mockDb.select
  const written: Array<Record<string, unknown>> = []
  ctx.mockDb.insert = (() => ({
    values: (v: Record<string, unknown>) => {
      written.push(v)
      return { returning: async () => [{ id: 'item-new', ...v }] }
    },
  })) as unknown as typeof ctx.mockDb.insert
  return written
}

describe('completedAtFor', () => {
  const now = new Date('2026-10-14T18:00:00Z')
  it('dates done items and clears everything else', () => {
    expect(completedAtFor('done', undefined, null, now)).toEqual(now)
    expect(completedAtFor('done', undefined, new Date('2026-10-01'), now)).toEqual(
      new Date('2026-10-01'),
    )
    expect(completedAtFor('done', new Date('2026-10-02'), null, now)).toEqual(
      new Date('2026-10-02'),
    )
    expect(completedAtFor('in_progress', new Date('2026-10-02'), new Date('2026-10-01'), now)).toBe(
      null,
    )
  })
})

describe('EngagementItemsService.create', () => {
  it('creates internal items by default, after the last one', async () => {
    const ctx = createTestContext()
    const written = sequence(ctx, [[{ id: 'eng-1' }], [{ next: 3 }]])
    await new EngagementItemsService(ctx).create('eng-1', { kind: 'milestone', title: 'Hito' })
    expect(written[0]).toMatchObject({
      engagementId: 'eng-1',
      kind: 'milestone',
      status: 'planned',
      side: 'madfam',
      clientVisible: false,
      completedAt: null,
      sortOrder: 3,
    })
  })

  it('dates an item created as done', async () => {
    const ctx = createTestContext()
    const written = sequence(ctx, [[{ id: 'eng-1' }], [{ next: 0 }]])
    await new EngagementItemsService(ctx).create('eng-1', {
      kind: 'deliverable',
      title: 'Entregable',
      status: 'done',
    })
    expect(written[0]?.completedAt).toBeInstanceOf(Date)
  })

  it('rejects an unknown engagement and an artifact of another engagement', async () => {
    const missing = createTestContext()
    sequence(missing, [[]])
    await expect(
      new EngagementItemsService(missing).create('nope', { kind: 'decision', title: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const ctx = createTestContext()
    const written = sequence(ctx, [[{ id: 'eng-1' }], []])
    await expect(
      new EngagementItemsService(ctx).create('eng-1', {
        kind: 'deliverable',
        title: 'X',
        artifactId: 'artifact-of-eng-2',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(written).toHaveLength(0)
  })

  it('maps a duplicate external key to ConflictError', async () => {
    const ctx = createTestContext()
    sequence(ctx, [[{ id: 'eng-1' }], [{ next: 0 }]])
    ctx.mockDb.insert = (() => ({
      values: () => ({
        returning: async () => {
          throw Object.assign(new Error('duplicate'), { cause: { code: '23505' } })
        },
      }),
    })) as unknown as typeof ctx.mockDb.insert
    await expect(
      new EngagementItemsService(ctx).create('eng-1', {
        kind: 'actionable',
        title: 'X',
        externalKey: 'acme-ejemplo/x',
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('EngagementItemsService.update', () => {
  function captureUpdate(ctx: ReturnType<typeof createTestContext>) {
    const sets: Array<Record<string, unknown>> = []
    ctx.mockDb.update = (() => ({
      set: (v: Record<string, unknown>) => {
        sets.push(v)
        return { where: () => ({ returning: async () => [{ ...item(), ...v }] }) }
      },
    })) as unknown as typeof ctx.mockDb.update
    return sets
  }

  it('sets completed_at when an item becomes done and clears it when reopened', async () => {
    const ctx = createTestContext()
    sequence(ctx, [[item()]])
    const sets = captureUpdate(ctx)
    await new EngagementItemsService(ctx).update('item-1', { status: 'done' })
    expect(sets[0]?.completedAt).toBeInstanceOf(Date)

    const reopen = createTestContext()
    sequence(reopen, [[item({ status: 'done', completedAt: new Date('2026-10-02') })]])
    const reopenSets = captureUpdate(reopen)
    await new EngagementItemsService(reopen).update('item-1', { status: 'in_progress' })
    expect(reopenSets[0]?.completedAt).toBeNull()
  })

  it('throws NotFoundError for an unknown item', async () => {
    const ctx = createTestContext()
    sequence(ctx, [[]])
    await expect(
      new EngagementItemsService(ctx).update('nope', { title: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('EngagementItemsService.reorder', () => {
  it('needs every item of the engagement exactly once', async () => {
    const ctx = createTestContext()
    sequence(ctx, [[item({ id: 'a' }), item({ id: 'b' })]])
    const service = new EngagementItemsService(ctx)
    await expect(service.reorder('eng-1', ['a'])).rejects.toBeInstanceOf(ValidationError)
    sequence(ctx, [[item({ id: 'a' }), item({ id: 'b' })]])
    await expect(service.reorder('eng-1', ['a', 'a'])).rejects.toBeInstanceOf(ValidationError)
    sequence(ctx, [[item({ id: 'a' }), item({ id: 'b' })]])
    await expect(service.reorder('eng-1', ['a', 'zzz'])).rejects.toBeInstanceOf(ValidationError)
  })

  it('writes positions in one transaction, scoped to the engagement', async () => {
    const ctx = createTestContext()
    sequence(ctx, [[item({ id: 'a' }), item({ id: 'b' })], []])
    const writes: Array<{ set: Record<string, unknown>; where: unknown }> = []
    ctx.mockDb.update = (() => ({
      set: (set: Record<string, unknown>) => ({
        where: async (where: unknown) => {
          writes.push({ set, where })
        },
      }),
    })) as unknown as typeof ctx.mockDb.update

    await new EngagementItemsService(ctx).reorder('eng-1', ['b', 'a'])

    expect(ctx.mockDb.transaction).toHaveBeenCalledTimes(1)
    expect(writes.map((w) => w.set.sortOrder)).toEqual([0, 1])
    const first = render(writes[0]?.where)
    expect(first.sql).toContain('"engagement_items"."engagement_id" = $2')
    expect(first.params).toEqual(['b', 'eng-1'])
  })
})

describe('EngagementItemsService.listForClient', () => {
  it('returns client_visible items of this engagement only, without owner or keys', async () => {
    const ctx = createTestContext()
    const qb = ctx.mockDb._qb
    const projections: unknown[] = []
    const wheres: unknown[] = []
    ctx.mockDb.select = ((projection: unknown) => {
      projections.push(projection)
      return qb
    }) as unknown as typeof ctx.mockDb.select
    qb.where.mockImplementation((w: unknown) => {
      wheres.push(w)
      return qb
    })

    await new EngagementItemsService(ctx).listForClient('eng-1')

    const query = render(wheres[0])
    expect(query.sql).toContain('"engagement_items"."engagement_id" = $1')
    expect(query.sql).toContain('"engagement_items"."client_visible" = $2')
    expect(query.params).toEqual(['eng-1', true])
    const keys = Object.keys(projections[0] as Record<string, unknown>)
    expect(keys).not.toContain('ownerUserId')
    expect(keys).not.toContain('externalKey')
    expect(keys).not.toContain('clientVisible')
  })
})

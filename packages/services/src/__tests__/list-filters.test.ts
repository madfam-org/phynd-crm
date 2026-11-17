/**
 * The read filters the list methods accept (status, source, stage, due window,
 * contact search). Real drizzle-orm and the real schema: each test renders the
 * WHERE clause the service handed to the database and checks the SQL itself,
 * so a filter that is accepted but never applied fails here.
 */
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { ActivitiesService } from '../activities/activities.service'
import { ContactsService } from '../contacts/contacts.service'
import { LeadsService } from '../leads/leads.service'
import { OpportunitiesService } from '../opportunities/opportunities.service'
import { containsPattern } from '../search/like-pattern'
import { createTestContext } from './helpers'

const dialect = new PgDialect()

type Ctx = ReturnType<typeof createTestContext>

/** The last WHERE clause given to the mock database, as SQL text and parameters. */
function lastWhere(ctx: Ctx): { sql: string; params: unknown[] } {
  const where = ctx.mockDb._qb.where.mock.calls.at(-1)?.[0] as SQL | undefined
  if (!where) return { sql: '', params: [] }
  const query = dialect.sqlToQuery(where)
  return { sql: query.sql, params: query.params }
}

describe('containsPattern', () => {
  it('wraps the text and escapes the LIKE wildcards and the escape character', () => {
    expect(containsPattern('ana')).toBe('%ana%')
    expect(containsPattern('100%')).toBe('%100\\%%')
    expect(containsPattern('a_b')).toBe('%a\\_b%')
    expect(containsPattern('a\\b')).toBe('%a\\\\b%')
  })
})

describe('ContactsService.list filters', () => {
  it('searches name, email and company and still excludes deleted contacts', async () => {
    const ctx = createTestContext([])
    await new ContactsService(ctx).list({ limit: 10 }, { query: '50%_off' })

    const { sql, params } = lastWhere(ctx)
    expect(sql).toBe(
      '("contacts"."deleted_at" is null and ("contacts"."name" ilike $1 or "contacts"."email" ilike $2 or "contacts"."company" ilike $3))',
    )
    expect(params).toEqual(['%50\\%\\_off%', '%50\\%\\_off%', '%50\\%\\_off%'])
    expect(ctx.mockDb._qb.limit).toHaveBeenCalledWith(11)
  })

  it('combines the search with the owner filter and the cursor', async () => {
    const ctx = createTestContext([])
    await new ContactsService(ctx).list({ cursor: 'c-1' }, { ownerId: 'u-1', query: 'ana' })

    const { sql, params } = lastWhere(ctx)
    expect(sql).toContain('"contacts"."deleted_at" is null')
    expect(sql).toContain('"contacts"."id" > $1')
    expect(sql).toContain('"contacts"."owner_id" = $2')
    expect(params).toEqual(['c-1', 'u-1', '%ana%', '%ana%', '%ana%'])
  })

  it('adds no search predicate without a query', async () => {
    const ctx = createTestContext([])
    await new ContactsService(ctx).list()
    expect(lastWhere(ctx).sql).toBe('"contacts"."deleted_at" is null')
  })
})

describe('LeadsService.list filters', () => {
  it('filters by status and source, exactly, and still excludes deleted and test leads', async () => {
    const ctx = createTestContext([])
    await new LeadsService(ctx).list(undefined, { status: 'qualified', source: 'web' })

    const { sql, params } = lastWhere(ctx)
    expect(sql).toBe(
      '("leads"."deleted_at" is null and "leads"."is_test" = $1 and "leads"."status" = $2 and "leads"."source" = $3)',
    )
    expect(params).toEqual([false, 'qualified', 'web'])
  })

  it('without filters, leaves out only deleted and test leads', async () => {
    const ctx = createTestContext([])
    await new LeadsService(ctx).list()
    const { sql, params } = lastWhere(ctx)
    expect(sql).toBe('("leads"."deleted_at" is null and "leads"."is_test" = $1)')
    expect(params).toEqual([false])
  })

  it('filters unassigned leads of one tier (the owner link)', async () => {
    const ctx = createTestContext([])
    await new LeadsService(ctx).list(undefined, { unassigned: true, tier: 'A' })
    const { sql, params } = lastWhere(ctx)
    expect(sql).toBe(
      '("leads"."deleted_at" is null and "leads"."owner_id" is null and "leads"."tier" = $1 and "leads"."is_test" = $2)',
    )
    expect(params).toEqual(['A', false])
  })

  it('an owner wins over unassigned; test leads only when asked', async () => {
    const ctx = createTestContext([])
    await new LeadsService(ctx).list(undefined, {
      ownerId: 'user-1',
      unassigned: true,
      includeTest: true,
    })
    const { sql, params } = lastWhere(ctx)
    expect(sql).toBe('("leads"."deleted_at" is null and "leads"."owner_id" = $1)')
    expect(params).toEqual(['user-1'])
  })
})

describe('OpportunitiesService.list filters', () => {
  it('filters by pipeline, stage and status, and still excludes deleted deals', async () => {
    const ctx = createTestContext([])
    await new OpportunitiesService(ctx).list(undefined, {
      pipelineId: 'pipeline_default_sales',
      stageId: 'stage_default_proposal',
      status: 'open',
    })

    const { sql, params } = lastWhere(ctx)
    expect(sql).toBe(
      '("opportunities"."deleted_at" is null and "opportunities"."pipeline_id" = $1 and "opportunities"."stage_id" = $2 and "opportunities"."status" = $3)',
    )
    expect(params).toEqual(['pipeline_default_sales', 'stage_default_proposal', 'open'])
  })
})

describe('ActivitiesService filters', () => {
  it('filters by status, type and a due window (from inclusive, before exclusive)', async () => {
    const ctx = createTestContext([])
    const dueFrom = new Date('2026-11-20T00:00:00.000Z')
    const dueBefore = new Date('2026-11-27T00:00:00.000Z')
    await new ActivitiesService(ctx).listRecent(undefined, {
      ownerId: 'u-1',
      status: 'pending',
      type: 'task',
      dueFrom,
      dueBefore,
    })

    const { sql, params } = lastWhere(ctx)
    expect(sql).toBe(
      '("activities"."owner_id" = $1 and "activities"."status" = $2 and "activities"."type" = $3 and "activities"."due_at" >= $4 and "activities"."due_at" < $5)',
    )
    expect(params).toEqual([
      'u-1',
      'pending',
      'task',
      '2026-11-20T00:00:00.000Z',
      '2026-11-27T00:00:00.000Z',
    ])
  })

  it('listRecentForEntity reads one record’s newest activities, capped', async () => {
    const rows = [{ id: 'a-2' }, { id: 'a-1' }]
    const ctx = createTestContext(rows)
    const result = await new ActivitiesService(ctx).listRecentForEntity('contact', 'c-1', 2)

    expect(result).toEqual(rows)
    const { sql, params } = lastWhere(ctx)
    expect(sql).toBe('("activities"."entity_type" = $1 and "activities"."entity_id" = $2)')
    expect(params).toEqual(['contact', 'c-1'])
    expect(ctx.mockDb._qb.limit).toHaveBeenCalledWith(2)
    const order = ctx.mockDb._qb.orderBy.mock.calls.at(-1) as SQL[]
    expect(order.map((item) => dialect.sqlToQuery(item).sql)).toEqual([
      '"activities"."created_at" desc',
      '"activities"."id" desc',
    ])
  })

  it('listRecentForEntity defaults to 20', async () => {
    const ctx = createTestContext([])
    await new ActivitiesService(ctx).listRecentForEntity('contact', 'c-1')
    expect(ctx.mockDb._qb.limit).toHaveBeenCalledWith(20)
  })
})

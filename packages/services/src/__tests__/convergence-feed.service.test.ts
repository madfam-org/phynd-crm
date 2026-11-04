/**
 * ConvergenceFeedService: what it asks the database for, and that the exact
 * period rule and customer lookup are applied to what comes back.
 * Drizzle is mocked, so conditions are inspected as tagged objects.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('drizzle-orm', () => {
  const tag =
    (op: string) =>
    (...args: unknown[]) => ({ op, args })
  return {
    and: tag('and'),
    asc: tag('asc'),
    eq: tag('eq'),
    exists: tag('exists'),
    gte: tag('gte'),
    inArray: tag('inArray'),
    isNull: tag('isNull'),
    lt: tag('lt'),
    ne: tag('ne'),
    notInArray: tag('notInArray'),
    notLike: tag('notLike'),
    or: tag('or'),
    sql: tag('sql'),
  }
})

vi.mock('@phynd/db/schema', () => {
  const table = (name: string, columns: string[]) =>
    Object.fromEntries(columns.map((column) => [column, `${name}.${column}`]))
  return {
    contacts: table('contacts', ['id', 'deletedAt']),
    conversions: table('conversions', ['opportunityId', 'type', 'convertedAt']),
    engagements: table('engagements', ['contactId', 'status', 'deletedAt']),
    leads: table('leads', [
      'id',
      'status',
      'contactId',
      'source',
      'score',
      'createdAt',
      'deletedAt',
    ]),
    opportunities: table('opportunities', [
      'id',
      'status',
      'stageId',
      'value',
      'probability',
      'contactId',
      'expectedCloseDate',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ]),
    pipelineStages: table('pipelineStages', ['id', 'name', 'probability']),
  }
})

import type { Database } from '@phynd/db'
import { ConvergenceFeedService } from '../convergence/convergence-feed'

type Condition = { op: string; args: unknown[] }

/** Awaited queries resolve, in order, to the queued results; sub-queries are never awaited. */
function createFakeDb(results: unknown[][]) {
  const queue = [...results]
  const awaited: { from: unknown; where: Condition }[] = []
  const db = {
    select: vi.fn(() => {
      const query: { from?: unknown; where?: Condition } = {}
      const builder = {
        from: (table: unknown) => {
          query.from = table
          return builder
        },
        leftJoin: () => builder,
        where: (condition: Condition) => {
          query.where = condition
          return builder
        },
        orderBy: () => builder,
        // biome-ignore lint/suspicious/noThenProperty: the fake query must be awaitable
        then: (resolve: (rows: unknown[]) => unknown) => {
          awaited.push(query as { from: unknown; where: Condition })
          return Promise.resolve(queue.shift() ?? []).then(resolve)
        },
      }
      return builder
    }),
  }
  return { db: db as unknown as Database, awaited }
}

/** Every tagged condition nested anywhere under `condition`. */
function flatten(condition: unknown): Condition[] {
  if (!condition || typeof condition !== 'object' || !('op' in condition)) return []
  const c = condition as Condition
  return [c, ...c.args.flatMap(flatten)]
}

const NOVEMBER = {
  start: new Date('2026-11-01T00:00:00.000Z'),
  end: new Date('2026-12-01T00:00:00.000Z'),
}

function leadRow(id: string, createdAt: string, contactId: string | null = null) {
  return {
    id,
    status: 'new',
    contactId,
    source: 'website',
    score: null,
    createdAt: new Date(createdAt),
  }
}

function oppRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'open',
    stageName: 'Proposal',
    stageProbability: 50,
    value: '1000.00',
    probability: null,
    contactId: null,
    expectedCloseDate: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    wonAt: null,
    ...overrides,
  }
}

describe('ConvergenceFeedService.listLeads', () => {
  it('filters on capture time, soft deletes, demo ids and the synthetic probe lead', async () => {
    const { db, awaited } = createFakeDb([[]])
    await new ConvergenceFeedService(db).listLeads(NOVEMBER)

    const conditions = flatten(awaited[0]?.where)
    expect(conditions).toContainEqual({ op: 'gte', args: ['leads.createdAt', NOVEMBER.start] })
    expect(conditions).toContainEqual({ op: 'lt', args: ['leads.createdAt', NOVEMBER.end] })
    expect(conditions).toContainEqual({ op: 'isNull', args: ['leads.deletedAt'] })
    expect(conditions).toContainEqual({ op: 'notLike', args: ['leads.id', 'demo-%'] })
    expect(conditions).toContainEqual({ op: 'ne', args: ['leads.source', 'synthetic-probe'] })
  })

  it('applies the exact [start, end) rule to the rows and skips the customer query without contacts', async () => {
    const { db, awaited } = createFakeDb([
      [
        leadRow('before', '2026-10-31T23:59:59.999Z'),
        leadRow('first', '2026-11-01T00:00:00.000Z'),
        leadRow('last', '2026-11-30T23:59:59.999Z'),
        leadRow('end', '2026-12-01T00:00:00.000Z'),
      ],
    ])
    const result = await new ConvergenceFeedService(db).listLeads(NOVEMBER)

    expect(result.items.map((item) => item.lead_id)).toEqual(['first', 'last'])
    expect(awaited).toHaveLength(1)
  })

  it('marks customer_id only for contacts the customer query returns', async () => {
    const { db, awaited } = createFakeDb([
      [
        leadRow('l1', '2026-11-02T00:00:00.000Z', 'c-customer'),
        leadRow('l2', '2026-11-03T00:00:00.000Z', 'c-prospect'),
        leadRow('l3', '2026-11-04T00:00:00.000Z', 'c-customer'),
      ],
      [{ id: 'c-customer' }],
    ])
    const result = await new ConvergenceFeedService(db).listLeads(NOVEMBER)

    expect(result.items).toEqual([
      expect.objectContaining({
        lead_id: 'l1',
        contact_id: 'c-customer',
        customer_id: 'c-customer',
      }),
      expect.not.objectContaining({ customer_id: expect.anything() }),
      expect.objectContaining({ lead_id: 'l3', customer_id: 'c-customer' }),
    ])
    const customerQuery = flatten(awaited[1]?.where)
    expect(customerQuery).toContainEqual({
      op: 'inArray',
      args: ['contacts.id', ['c-customer', 'c-prospect']],
    })
    expect(customerQuery).toContainEqual({ op: 'isNull', args: ['contacts.deletedAt'] })
  })
})

describe('ConvergenceFeedService.listOpportunities', () => {
  it('narrows to opportunities created before period_end, not deleted, not demo', async () => {
    const { db, awaited } = createFakeDb([[]])
    await new ConvergenceFeedService(db).listOpportunities(NOVEMBER)

    const conditions = flatten(awaited[0]?.where)
    expect(conditions).toContainEqual({ op: 'lt', args: ['opportunities.createdAt', NOVEMBER.end] })
    expect(conditions).toContainEqual({ op: 'isNull', args: ['opportunities.deletedAt'] })
    expect(conditions).toContainEqual({ op: 'notLike', args: ['opportunities.id', 'demo-%'] })
    expect(conditions).toContainEqual({
      op: 'notInArray',
      args: ['opportunities.status', ['won', 'lost']],
    })
  })

  it('returns open deals plus deals closed within or after the period', async () => {
    const { db } = createFakeDb([
      [
        oppRow('open'),
        oppRow('won-before', { status: 'won', wonAt: new Date('2026-10-20T00:00:00.000Z') }),
        oppRow('won-inside', { status: 'won', wonAt: new Date('2026-11-20T00:00:00.000Z') }),
        oppRow('lost-before', { status: 'lost', updatedAt: new Date('2026-10-25T00:00:00.000Z') }),
        oppRow('lost-inside', { status: 'lost', updatedAt: new Date('2026-11-25T00:00:00.000Z') }),
        oppRow('created-after', { createdAt: new Date('2026-12-02T00:00:00.000Z') }),
      ],
    ])
    const result = await new ConvergenceFeedService(db).listOpportunities(NOVEMBER)

    expect(result.items.map((item) => [item.opportunity_id, item.stage])).toEqual([
      ['open', 'Proposal'],
      ['won-inside', 'closed_won'],
      ['lost-inside', 'closed_lost'],
    ])
  })

  it('reports opportunities left out for a missing value', async () => {
    const { db } = createFakeDb([[oppRow('priced'), oppRow('unpriced', { value: null })]])
    const result = await new ConvergenceFeedService(db).listOpportunities(NOVEMBER)

    expect(result.items.map((item) => item.opportunity_id)).toEqual(['priced'])
    expect(result.omitted).toEqual({ missing_value: 1 })
  })
})

describe('ConvergenceFeedService.customerContactIds', () => {
  let db: Database
  let awaited: { from: unknown; where: Condition }[]

  beforeEach(() => {
    ;({ db, awaited } = createFakeDb([[{ id: 'c1' }]]))
  })

  it('counts a won opportunity or a live engagement, and dedupes ids', async () => {
    const ids = await new ConvergenceFeedService(db).customerContactIds(['c1', 'c1', null, 'c2'])

    expect([...ids]).toEqual(['c1'])
    const conditions = flatten(awaited[0]?.where)
    expect(conditions).toContainEqual({ op: 'inArray', args: ['contacts.id', ['c1', 'c2']] })
    expect(conditions.filter((condition) => condition.op === 'exists')).toHaveLength(2)
  })
})

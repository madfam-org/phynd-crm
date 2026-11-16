import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  deriveCustomerHealth,
  latestPaymentOutcomes,
  withCustomerHealth,
} from '../contacts/customer-health'
import { createTestContext } from './helpers'

const dialect = new PgDialect()

describe('deriveCustomerHealth', () => {
  it.each([
    ['former_customer', null, 'cancelled'],
    ['former_customer', 'failed', 'cancelled'],
    ['customer', 'failed', 'payment_failed'],
    ['customer', 'paid', 'ok'],
    ['customer', null, 'ok'],
    ['lead', 'failed', 'payment_failed'],
    ['lead', 'paid', null],
    ['lead', null, null],
    [null, null, null],
  ] as const)('%s with latest outcome %s → %s', (stage, outcome, health) => {
    expect(deriveCustomerHealth(stage, outcome)).toBe(health)
  })
})

describe('latestPaymentOutcomes', () => {
  it('reads the payment conversions of the whole page in one query, newest first', async () => {
    const ctx = createTestContext([
      { contactId: 'c-1', type: 'dhanam_invoice_payment_failed', convertedAt: new Date(3) },
      { contactId: 'c-2', type: 'dhanam_payment_succeeded', convertedAt: new Date(3) },
      { contactId: 'c-1', type: 'dhanam_checkout_completed', convertedAt: new Date(2) },
      { contactId: 'c-2', type: 'dhanam_payment_failed', convertedAt: new Date(1) },
    ])
    const outcomes = await latestPaymentOutcomes(ctx, ['c-1', 'c-2', 'c-3'])
    expect(Object.fromEntries(outcomes)).toEqual({ 'c-1': 'failed', 'c-2': 'paid' })

    const where = ctx.mockDb._qb.where.mock.calls.at(-1)?.[0] as SQL
    const query = dialect.sqlToQuery(where)
    expect(query.sql).toBe(
      '("conversions"."contact_id" in ($1, $2, $3) and "conversions"."type" in ($4, $5, $6, $7, $8))',
    )
    expect(query.params.slice(0, 3)).toEqual(['c-1', 'c-2', 'c-3'])
    expect(ctx.mockDb.select).toHaveBeenCalledTimes(1)
  })

  it('does not query for an empty page', async () => {
    const ctx = createTestContext([])
    expect((await latestPaymentOutcomes(ctx, [])).size).toBe(0)
    expect(ctx.mockDb.select).not.toHaveBeenCalled()
  })
})

describe('withCustomerHealth', () => {
  it('adds the derived health to each contact', async () => {
    const ctx = createTestContext([
      { contactId: 'c-1', type: 'dhanam_payment_failed', convertedAt: new Date(1) },
    ])
    const rows = await withCustomerHealth(ctx, [
      { id: 'c-1', lifecycleStage: 'customer' },
      { id: 'c-2', lifecycleStage: 'former_customer' },
      { id: 'c-3', lifecycleStage: 'lead' },
    ])
    expect(rows).toEqual([
      { id: 'c-1', lifecycleStage: 'customer', health: 'payment_failed' },
      { id: 'c-2', lifecycleStage: 'former_customer', health: 'cancelled' },
      { id: 'c-3', lifecycleStage: 'lead', health: null },
    ])
  })
})

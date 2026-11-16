import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { isMoneyReceivedEvent, markCustomer, markFormerCustomer } from '../contacts/customer-stage'
import { createTestContext } from './helpers'

const dialect = new PgDialect()
type Ctx = ReturnType<typeof createTestContext>

function queue(ctx: Ctx, ...results: unknown[]): void {
  for (const result of results) {
    ctx.mockDb._qb.then.mockImplementationOnce((resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
    )
  }
}

function whereSql(ctx: Ctx, index: number): string {
  const where = ctx.mockDb._qb.where.mock.calls.at(index)?.[0] as SQL
  return dialect.sqlToQuery(where).sql
}

const AT = new Date('2026-11-10T12:00:00.000Z')

describe('customer stage rule', () => {
  it('makes a lead, or a former customer changed no later than the payment, a customer', async () => {
    const ctx = createTestContext([])
    queue(ctx, [{ id: 'c-1' }])
    expect(await markCustomer(ctx.db, 'c-1', AT)).toEqual({ stage: 'customer', changed: true })
    expect(ctx.mockDb._qb.set).toHaveBeenCalledWith({
      lifecycleStage: 'customer',
      lifecycleStageChangedAt: AT,
    })
    expect(whereSql(ctx, -1)).toBe(
      '("contacts"."id" = $1 and ("contacts"."lifecycle_stage" = $2 or ("contacts"."lifecycle_stage" = $3 and ("contacts"."lifecycle_stage_changed_at" is null or "contacts"."lifecycle_stage_changed_at" <= $4))))',
    )
  })

  it('reports no change of stage when the guard matches no row', async () => {
    const ctx = createTestContext([])
    queue(ctx, [], [])
    expect(await markCustomer(ctx.db, 'c-1', AT)).toEqual({ stage: 'customer', changed: false })
  })

  it("moves a customer's change time forward to a later payment, without changing the stage", async () => {
    const ctx = createTestContext([])
    queue(ctx, [], [])
    await markCustomer(ctx.db, 'c-1', AT)
    expect(ctx.mockDb.update).toHaveBeenCalledTimes(2)
    expect(ctx.mockDb._qb.set).toHaveBeenLastCalledWith({ lifecycleStageChangedAt: AT })
    const query = dialect.sqlToQuery(ctx.mockDb._qb.where.mock.calls.at(-1)?.[0] as SQL)
    // Only a customer, and only forward: an older payment never moves it back.
    expect(query.sql).toBe(
      '("contacts"."id" = $1 and "contacts"."lifecycle_stage" = $2 and ("contacts"."lifecycle_stage_changed_at" is null or "contacts"."lifecycle_stage_changed_at" < $3))',
    )
    expect(query.params.slice(0, 2)).toEqual(['c-1', 'customer'])
  })

  it('does not run the second update when the stage changed', async () => {
    const ctx = createTestContext([])
    queue(ctx, [{ id: 'c-1' }])
    await markCustomer(ctx.db, 'c-1', AT)
    expect(ctx.mockDb.update).toHaveBeenCalledTimes(1)
  })

  it('ends a customer with nothing else active, as of the event', async () => {
    const ctx = createTestContext([])
    queue(ctx, [{ stage: 'customer', changedAt: new Date('2026-11-01') }], [], [], [{ id: 'c-1' }])
    expect(await markFormerCustomer(ctx.db, 'c-1', AT, { orderId: 'o-1' })).toEqual({
      stage: 'former_customer',
      changed: true,
    })
    expect(ctx.mockDb._qb.set).toHaveBeenLastCalledWith({
      lifecycleStage: 'former_customer',
      lifecycleStageChangedAt: AT,
    })
    // The order check counts partly refunded orders and skips the ended one.
    const orderWhere = ctx.mockDb._qb.where.mock.calls.at(1)?.[0] as SQL
    const query = dialect.sqlToQuery(orderWhere)
    expect(query.sql).toContain('"orders"."payment_status" in ($2, $3, $4)')
    expect(query.params).toEqual(['c-1', 'paid', 'partial', 'partial_refund', 'o-1'])
  })

  it('keeps a customer with another paid order', async () => {
    const ctx = createTestContext([])
    queue(ctx, [{ stage: 'customer', changedAt: null }], [{ id: 'o-2' }])
    expect(await markFormerCustomer(ctx.db, 'c-1', AT, {})).toEqual({
      stage: 'customer',
      changed: false,
      kept: 'other_active_paid_relationship',
    })
    expect(ctx.mockDb.update).not.toHaveBeenCalled()
  })

  it('ignores an end older than the change that made the customer, and non-customers', async () => {
    const ctx = createTestContext([])
    queue(ctx, [{ stage: 'customer', changedAt: new Date('2026-11-20') }])
    expect(await markFormerCustomer(ctx.db, 'c-1', AT, {})).toBeNull()
    queue(ctx, [{ stage: 'lead', changedAt: null }])
    expect(await markFormerCustomer(ctx.db, 'c-1', AT, {})).toBeNull()
    expect(ctx.mockDb.update).not.toHaveBeenCalled()
  })
})

describe('money received', () => {
  it('is a successful payment, or a checkout whose payment is collected', () => {
    expect(isMoneyReceivedEvent('invoice.payment_succeeded', null)).toBe(true)
    expect(isMoneyReceivedEvent('payment.succeeded', undefined)).toBe(true)
    expect(isMoneyReceivedEvent('checkout.session.completed', 'paid')).toBe(true)
  })

  it('is not a subscription start nor a checkout completed before its payment', () => {
    expect(isMoneyReceivedEvent('customer.subscription.created', null)).toBe(false)
    expect(isMoneyReceivedEvent('subscription.created', 'paid')).toBe(false)
    expect(isMoneyReceivedEvent('checkout.session.completed', 'unpaid')).toBe(false)
    expect(isMoneyReceivedEvent('checkout.session.completed', null)).toBe(false)
  })
})

import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  CASE_DEFAULT_DUE_BUSINESS_DAYS,
  addBusinessDaysEndOfDay,
  defaultCaseDueAt,
  isCaseOverdue,
} from '../cases/case-deadlines'
import { CasesService } from '../cases/cases.service'
import { NotFoundError } from '../errors'
import { createTestContext } from './helpers'

const dialect = new PgDialect()
type Ctx = ReturnType<typeof createTestContext>

/** Answers the next awaited queries, in order, with these results. */
function queue(ctx: Ctx, ...results: unknown[]): void {
  for (const result of results) {
    ctx.mockDb._qb.then.mockImplementationOnce((resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
    )
  }
}

function lastWhereSql(ctx: Ctx): string {
  const where = ctx.mockDb._qb.where.mock.calls.at(-1)?.[0] as SQL | undefined
  return where ? dialect.sqlToQuery(where).sql : ''
}

describe('case deadlines', () => {
  it('counts business days after the opening day and ends at 23:59:59.999 Mexico City', () => {
    // Monday 2026-11-16 10:00 Mexico City (16:00 UTC).
    const monday = new Date('2026-11-16T16:00:00.000Z')
    expect(addBusinessDaysEndOfDay(monday, 1).toISOString()).toBe('2026-11-18T05:59:59.999Z')
    // Five business days after a Monday is the next Monday.
    expect(addBusinessDaysEndOfDay(monday, 5).toISOString()).toBe('2026-11-24T05:59:59.999Z')
  })

  it('skips weekends, including an opening on Saturday', () => {
    // Friday 2026-11-20 17:00 Mexico City.
    const friday = new Date('2026-11-20T23:00:00.000Z')
    expect(addBusinessDaysEndOfDay(friday, 1).toISOString()).toBe('2026-11-24T05:59:59.999Z')
    // Saturday 2026-11-21 09:00 Mexico City: the next business day is Monday.
    const saturday = new Date('2026-11-21T15:00:00.000Z')
    expect(addBusinessDaysEndOfDay(saturday, 1).toISOString()).toBe('2026-11-24T05:59:59.999Z')
  })

  it('uses the Mexico City calendar day, not the UTC one', () => {
    // 2026-11-17 02:00 UTC is still Monday 2026-11-16 20:00 in Mexico City.
    const lateMonday = new Date('2026-11-17T02:00:00.000Z')
    expect(addBusinessDaysEndOfDay(lateMonday, 1).toISOString()).toBe('2026-11-18T05:59:59.999Z')
  })

  it('gives a data-rights request 20 business days, as the published privacy notice states', () => {
    expect(CASE_DEFAULT_DUE_BUSINESS_DAYS).toEqual({
      support: 3,
      refund: 5,
      data_rights: 20,
      invoice_correction: 5,
    })
    const monday = new Date('2026-11-16T16:00:00.000Z')
    // Four full weeks of business days later: Monday 2026-12-14.
    expect(defaultCaseDueAt('data_rights', monday).toISOString()).toBe(
      '2026-12-15T05:59:59.999Z',
    )
  })

  it('is overdue only while unresolved past its due date', () => {
    const now = new Date('2026-11-20T00:00:00.000Z')
    const past = new Date('2026-11-19T00:00:00.000Z')
    const future = new Date('2026-11-21T00:00:00.000Z')
    expect(isCaseOverdue({ status: 'open', dueAt: past }, now)).toBe(true)
    expect(isCaseOverdue({ status: 'in_progress', dueAt: past.toISOString() }, now)).toBe(true)
    expect(isCaseOverdue({ status: 'resolved', dueAt: past }, now)).toBe(false)
    expect(isCaseOverdue({ status: 'open', dueAt: future }, now)).toBe(false)
  })
})

describe('CasesService', () => {
  const NOW = new Date('2026-11-16T16:00:00.000Z')

  it('opens a case for a live contact, owned by the caller, due by its type when no date is given', async () => {
    const ctx = createTestContext([], { auth: { crmUserId: 'user-1' } })
    queue(ctx, [{ id: 'contact-1' }], [{ id: 'case-1' }])
    await new CasesService(ctx).create(
      { contactId: 'contact-1', type: 'refund', summary: 'Cargo duplicado' },
      NOW,
    )
    expect(ctx.mockDb._qb.values).toHaveBeenCalledWith({
      contactId: 'contact-1',
      type: 'refund',
      summary: 'Cargo duplicado',
      status: 'open',
      openedAt: NOW,
      dueAt: defaultCaseDueAt('refund', NOW),
      ownerId: 'user-1',
    })
  })

  it('keeps a given due date and an explicit empty owner', async () => {
    const ctx = createTestContext([])
    queue(ctx, [{ id: 'contact-1' }], [{ id: 'case-1' }])
    const dueAt = new Date('2026-11-30T00:00:00.000Z')
    await new CasesService(ctx).create(
      { contactId: 'contact-1', type: 'support', summary: 'Duda', dueAt, ownerId: null },
      NOW,
    )
    expect(ctx.mockDb._qb.values).toHaveBeenCalledWith(
      expect.objectContaining({ dueAt, ownerId: null }),
    )
  })

  it('refuses a contact that does not exist or was deleted', async () => {
    const ctx = createTestContext([])
    queue(ctx, [])
    await expect(
      new CasesService(ctx).create({ contactId: 'gone', type: 'support', summary: 'x' }, NOW),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(lastWhereSql(ctx)).toBe('("contacts"."id" = $1 and "contacts"."deleted_at" is null)')
    expect(ctx.mockDb.insert).not.toHaveBeenCalled()
  })

  it('stamps resolvedAt on resolving and clears it on reopening', async () => {
    const ctx = createTestContext([])
    queue(ctx, [{ id: 'case-1', status: 'open' }], [{ id: 'case-1', status: 'resolved' }])
    await new CasesService(ctx).update('case-1', { status: 'resolved' }, NOW)
    expect(ctx.mockDb._qb.set).toHaveBeenLastCalledWith({
      updatedAt: NOW,
      status: 'resolved',
      resolvedAt: NOW,
    })

    queue(ctx, [{ id: 'case-1', status: 'resolved' }], [{ id: 'case-1', status: 'open' }])
    await new CasesService(ctx).update('case-1', { status: 'in_progress' }, NOW)
    expect(ctx.mockDb._qb.set).toHaveBeenLastCalledWith({
      updatedAt: NOW,
      status: 'in_progress',
      resolvedAt: null,
    })
  })

  it('does not recompute the due date when only the type changes', async () => {
    const ctx = createTestContext([])
    queue(ctx, [{ id: 'case-1', status: 'open' }], [{ id: 'case-1' }])
    await new CasesService(ctx).update('case-1', { type: 'data_rights' }, NOW)
    expect(ctx.mockDb._qb.set).toHaveBeenLastCalledWith({ updatedAt: NOW, type: 'data_rights' })
  })

  it('refuses to update an unknown case', async () => {
    const ctx = createTestContext([])
    queue(ctx, [])
    await expect(new CasesService(ctx).update('nope', { summary: 'x' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('lists unresolved cases of one contact, newest opened first', async () => {
    const ctx = createTestContext([])
    await new CasesService(ctx).list({ limit: 10 }, { unresolved: true, contactId: 'contact-1' })
    expect(lastWhereSql(ctx)).toBe(
      '("cases"."status" <> $1 and "cases"."contact_id" = $2)',
    )
    expect(ctx.mockDb._qb.limit).toHaveBeenCalledWith(11)
    expect(ctx.mockDb._qb.leftJoin).toHaveBeenCalledTimes(1)
  })
})

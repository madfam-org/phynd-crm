import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reconcileDhanamPayment } from '../payments/payment-reconciliation.service'
import { type MockDatabase, createTestContext, makeOrder } from './helpers'

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  desc: vi.fn((col: unknown) => ({ _tag: 'desc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

vi.mock('@phyne/db/schema', () => ({
  engagementEvents: { id: 'engagementEvents.id' },
  engagements: {
    contactId: 'engagements.contactId',
    deletedAt: 'engagements.deletedAt',
    id: 'engagements.id',
    opportunityId: 'engagements.opportunityId',
    status: 'engagements.status',
  },
  externalReferences: {
    entityId: 'externalReferences.entityId',
    entityType: 'externalReferences.entityType',
    externalId: 'externalReferences.externalId',
    id: 'externalReferences.id',
    provider: 'externalReferences.provider',
  },
  orders: {
    contactId: 'orders.contactId',
    createdAt: 'orders.createdAt',
    deletedAt: 'orders.deletedAt',
    id: 'orders.id',
    opportunityId: 'orders.opportunityId',
    quoteId: 'orders.quoteId',
  },
}))

describe('reconcileDhanamPayment', () => {
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('marks a matching order paid, records the provider reference, and writes a milestone', async () => {
    const order = makeOrder({
      id: 'order-001',
      contactId: 'contact-001',
      opportunityId: 'opp-001',
      quoteId: 'quote-001',
      totalAmount: '420.00',
      currency: 'MXN',
      status: 'pending',
    })

    installAwaitSequence([[order], [{ id: 'eng-001' }], [], [], [], []])

    const result = await reconcileDhanamPayment(mockDb as never, {
      amountMinor: 42_000,
      contactId: 'contact-001',
      currency: 'MXN',
      eventId: 'evt-payment-001',
      eventType: 'payment.succeeded',
      externalPaymentId: 'pi-001',
    })

    expect(result).toEqual({
      engagementId: 'eng-001',
      orderId: 'order-001',
      paidAmount: '420.00',
      paymentStatus: 'paid',
      quoteId: 'quote-001',
      status: 'reconciled',
    })
    expect(mockDb._qb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        externalPaymentId: 'pi-001',
        paidAmount: '420.00',
        paymentProvider: 'dhanam',
        paymentStatus: 'paid',
        status: 'confirmed',
      }),
    )

    const values = mockDb._qb.values.mock.calls.map((call) => call[0] as Record<string, unknown>)
    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'order',
          entityId: 'order-001',
          provider: 'dhanam',
          externalId: 'pi-001',
          externalType: 'payment',
        }),
        expect.objectContaining({
          engagementId: 'eng-001',
          source: 'system',
          eventType: 'system:payment_reconciled',
          dedupKey: 'payment:evt-payment-001:reconciled',
        }),
      ]),
    )
  })

  it('accumulates partial payments without moving an already confirmed order backward', async () => {
    const order = makeOrder({
      id: 'order-001',
      contactId: 'contact-001',
      opportunityId: 'opp-001',
      totalAmount: '500.00',
      paidAmount: '100.00',
      status: 'confirmed',
    })

    installAwaitSequence([[order], [{ id: 'eng-001' }], [], [], [], []])

    const result = await reconcileDhanamPayment(mockDb as never, {
      amountMinor: 15_000,
      contactId: 'contact-001',
      currency: 'USD',
      eventId: 'evt-payment-002',
      eventType: 'payment.succeeded',
    })

    expect(result.paymentStatus).toBe('partial')
    expect(result.paidAmount).toBe('250.00')
    expect(mockDb._qb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        paidAmount: '250.00',
        paymentStatus: 'partial',
        status: 'confirmed',
      }),
    )
  })

  it('records an unmatched timeline event when no active order can be resolved', async () => {
    installAwaitSequence([[], [], [{ id: 'eng-001' }], []])

    const result = await reconcileDhanamPayment(mockDb as never, {
      amountMinor: 42_000,
      contactId: 'contact-001',
      currency: 'MXN',
      eventId: 'evt-payment-003',
      eventType: 'payment.succeeded',
      quoteId: 'quote-missing-order',
    })

    expect(result).toEqual({
      engagementId: 'eng-001',
      orderId: null,
      paidAmount: null,
      paymentStatus: null,
      quoteId: null,
      status: 'unmatched',
    })
    expect(mockDb._qb.set).not.toHaveBeenCalled()
    expect(mockDb._qb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        engagementId: 'eng-001',
        source: 'system',
        eventType: 'system:payment_unmatched',
        status: 'blocked',
        dedupKey: 'payment:evt-payment-003:unmatched',
      }),
    )
  })

  it('does not double-count when the Dhanam payment reference already exists', async () => {
    const order = makeOrder({
      id: 'order-001',
      contactId: 'contact-001',
      opportunityId: 'opp-001',
      quoteId: 'quote-001',
      paidAmount: '420.00',
      paymentStatus: 'paid',
      totalAmount: '420.00',
    })

    installAwaitSequence([[order], [{ id: 'eng-001' }], [{ id: 'ref-existing' }]])

    const result = await reconcileDhanamPayment(mockDb as never, {
      amountMinor: 42_000,
      contactId: 'contact-001',
      currency: 'USD',
      eventId: 'evt-payment-004',
      eventType: 'invoice.payment_succeeded',
      externalPaymentId: 'pi-existing',
    })

    expect(result).toEqual({
      engagementId: 'eng-001',
      orderId: 'order-001',
      paidAmount: '420.00',
      paymentStatus: 'paid',
      quoteId: 'quote-001',
      status: 'reconciled',
    })
    expect(mockDb._qb.set).not.toHaveBeenCalled()
    expect(mockDb._qb.values).not.toHaveBeenCalled()
  })

  function installAwaitSequence(results: unknown[][]) {
    let callCount = 0
    mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
      const result = results[callCount] ?? []
      callCount += 1
      return Promise.resolve(result).then(resolve)
    })
  }
})

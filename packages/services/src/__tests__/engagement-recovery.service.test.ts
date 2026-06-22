import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngagementRecoveryService } from '../engagements/engagement-recovery.service'
import { ValidationError } from '../errors'
import { createMockQueryBuilder, createTestContext } from './helpers'

vi.mock('../payments/payment-reconciliation.service', () => ({
  reconcileDhanamPayment: vi.fn(async () => ({
    engagementId: 'eng-001',
    orderId: 'order-001',
    paidAmount: '100.00',
    paymentStatus: 'paid',
    quoteId: 'quote-001',
    status: 'reconciled',
  })),
}))

vi.mock('../production/production-dispatch.service', () => ({
  recordProductionDispatchIntent: vi.fn(async () => ({
    blocked: false,
    dispatchedTracks: ['fabrication'],
  })),
}))

vi.mock('@phynd/db/schema', () => ({
  engagementEvents: {
    id: 'engagementEvents.id',
    engagementId: 'engagementEvents.engagementId',
    status: 'engagementEvents.status',
    eventType: 'engagementEvents.eventType',
    metadata: 'engagementEvents.metadata',
    message: 'engagementEvents.message',
  },
  engagements: {
    id: 'engagements.id',
    deletedAt: 'engagements.deletedAt',
    contactId: 'engagements.contactId',
    opportunityId: 'engagements.opportunityId',
  },
  orders: {
    id: 'orders.id',
    deletedAt: 'orders.deletedAt',
    contactId: 'orders.contactId',
    opportunityId: 'orders.opportunityId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  desc: vi.fn((col: unknown) => ({ _tag: 'desc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

describe('EngagementRecoveryService', () => {
  let ctx: ReturnType<typeof createTestContext>

  beforeEach(() => {
    ctx = createTestContext()
    vi.clearAllMocks()
  })

  it('lists blocked events for an engagement', async () => {
    const blocked = [
      {
        id: 'evt-1',
        engagementId: 'eng-001',
        eventType: 'system:payment_unmatched',
        status: 'blocked',
        message: 'Payment received but no matching order was found',
        metadata: {},
      },
    ]

    ctx.db.select = vi
      .fn()
      .mockReturnValueOnce(createMockQueryBuilder([{ id: 'eng-001' }]))
      .mockReturnValueOnce(createMockQueryBuilder(blocked)) as typeof ctx.db.select

    const service = new EngagementRecoveryService(ctx)
    const result = await service.listBlockedEvents('eng-001')

    expect(result).toHaveLength(1)
    expect(result[0]?.eventType).toBe('system:payment_unmatched')
  })

  it('rejects linking payment when event is not a payment mismatch', async () => {
    const blockedEvent = {
      id: 'evt-dispatch',
      engagementId: 'eng-001',
      eventType: 'system:production_dispatch_blocked',
      status: 'blocked',
      message: 'blocked',
      metadata: { order_id: 'order-001' },
    }

    ctx.db.select = vi.fn(() => createMockQueryBuilder([blockedEvent])) as typeof ctx.db.select
    ctx.db.update = vi.fn(() => createMockQueryBuilder([])) as typeof ctx.db.update

    const service = new EngagementRecoveryService(ctx)
    await expect(
      service.linkPaymentToOrder({ blockedEventId: 'evt-dispatch', orderId: 'order-001' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

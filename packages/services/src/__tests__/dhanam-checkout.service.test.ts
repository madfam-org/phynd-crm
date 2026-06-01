import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DhanamCheckoutService } from '../payments/dhanam-checkout.service'
import { type MockDatabase, createTestContext, makeContact, makeOrder, makeQuote } from './helpers'

const acceptMock = vi.hoisted(() => vi.fn())

vi.mock('../quotes/quotes.service', () => ({
  QuotesService: vi.fn(() => ({
    accept: acceptMock,
  })),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  desc: vi.fn((col: unknown) => ({ _tag: 'desc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

vi.mock('@phynd/db/schema', () => ({
  contacts: {
    deletedAt: 'contacts.deletedAt',
    email: 'contacts.email',
    id: 'contacts.id',
  },
  engagementArtifacts: { id: 'engagementArtifacts.id' },
  engagementEvents: { id: 'engagementEvents.id' },
  engagements: {
    contactId: 'engagements.contactId',
    createdAt: 'engagements.createdAt',
    deletedAt: 'engagements.deletedAt',
    id: 'engagements.id',
    opportunityId: 'engagements.opportunityId',
    status: 'engagements.status',
  },
  externalReferences: {
    createdAt: 'externalReferences.createdAt',
    entityId: 'externalReferences.entityId',
    entityType: 'externalReferences.entityType',
    externalId: 'externalReferences.externalId',
    externalType: 'externalReferences.externalType',
    metadata: 'externalReferences.metadata',
    provider: 'externalReferences.provider',
  },
  quotes: {
    contactId: 'quotes.contactId',
    id: 'quotes.id',
    opportunityId: 'quotes.opportunityId',
  },
}))

describe('DhanamCheckoutService', () => {
  let mockDb: MockDatabase
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        checkout_url: 'https://pay.dhan.am/session/co_001',
        expires_at: '2026-06-01T00:00:00.000Z',
        session_id: 'co_001',
      }),
    })
    acceptMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a quote, creates a signed Dhanam checkout, and records portal artifacts', async () => {
    const quote = makeQuote({
      contactId: 'contact-001',
      currency: 'mxn',
      id: 'quote-001',
      opportunityId: 'opp-001',
      quoteNumber: 'Q-2026-0001',
      status: 'accepted',
      totalAmount: '420.00',
    })
    const order = makeOrder({ id: 'order-001', quoteId: 'quote-001' })
    const engagement = makeEngagement()
    acceptMock.mockResolvedValue({ engagementId: 'eng-001', order, quote })
    installAwaitSequence([
      [makeContact({ email: 'client@example.com' })],
      [engagement],
      [],
      [],
      [],
      [],
    ])

    const result = await service().createForQuote({
      engagementId: 'eng-001',
      quoteId: 'quote-001',
      source: 'portal',
    })

    expect(acceptMock).toHaveBeenCalledWith('quote-001', {
      createOrder: true,
      source: 'portal',
    })
    expect(result).toEqual({
      amountMinor: 42_000,
      cancelUrl: 'https://phynd.app/portal/eng-001?checkout=cancelled',
      checkoutUrl: 'https://pay.dhan.am/session/co_001',
      currency: 'MXN',
      engagementId: 'eng-001',
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
      orderId: 'order-001',
      quoteId: 'quote-001',
      reused: false,
      sessionId: 'co_001',
      successUrl: 'https://phynd.app/portal/eng-001?checkout=success',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-staging.dhan.am/v1/checkout/sessions',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-PhyndCRM-Signature': expect.stringMatching(/^sha256=/),
        }),
        method: 'POST',
      }),
    )
    const fetchCall = fetchMock.mock.calls[0]
    expect(fetchCall).toBeDefined()
    const payload = JSON.parse(fetchCall?.[1].body as string)
    expect(payload).toMatchObject({
      type: 'quote.checkout.requested',
      data: {
        amount_minor: 42_000,
        currency: 'MXN',
        engagement_id: 'eng-001',
        order_id: 'order-001',
        quote_id: 'quote-001',
      },
    })

    const values = mockDb._qb.values.mock.calls.map((call) => call[0] as Record<string, unknown>)
    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'quote',
          entityId: 'quote-001',
          provider: 'dhanam',
          externalId: 'co_001',
          externalType: 'checkout_session',
        }),
        expect.objectContaining({
          engagementId: 'eng-001',
          type: 'invoice',
          entityType: 'quote',
          entityId: 'quote-001',
          url: 'https://pay.dhan.am/session/co_001',
        }),
        expect.objectContaining({
          engagementId: 'eng-001',
          source: 'system',
          eventType: 'system:checkout_created',
          dedupKey: 'checkout:co_001:created',
        }),
      ]),
    )
  })

  it('reuses an existing quote checkout reference without calling Dhanam again', async () => {
    const quote = makeQuote({ contactId: 'contact-001', id: 'quote-001', totalAmount: '420.00' })
    const order = makeOrder({ id: 'order-001', quoteId: 'quote-001' })
    acceptMock.mockResolvedValue({ engagementId: 'eng-001', order, quote })
    installAwaitSequence([
      [makeContact({ email: 'client@example.com' })],
      [makeEngagement()],
      [
        {
          externalId: 'co_existing',
          metadata: {
            amount_minor: 42_000,
            checkout_url: 'https://pay.dhan.am/session/co_existing',
            currency: 'USD',
            order_id: 'order-001',
            session_id: 'co_existing',
          },
        },
      ],
    ])

    const result = await service().createForQuote({ engagementId: 'eng-001', quoteId: 'quote-001' })

    expect(result.reused).toBe(true)
    expect(result.checkoutUrl).toBe('https://pay.dhan.am/session/co_existing')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockDb._qb.values).not.toHaveBeenCalled()
  })

  it('charges only the remaining balance when an order is partially paid', async () => {
    const quote = makeQuote({ contactId: 'contact-001', id: 'quote-001', totalAmount: '420.00' })
    const order = makeOrder({ id: 'order-001', paidAmount: '100.00', quoteId: 'quote-001' })
    acceptMock.mockResolvedValue({ engagementId: 'eng-001', order, quote })
    installAwaitSequence([[makeContact({ email: 'client@example.com' })], [makeEngagement()], []])

    const result = await service().createForQuote({ engagementId: 'eng-001', quoteId: 'quote-001' })

    expect(result.amountMinor).toBe(32_000)
    const fetchCall = fetchMock.mock.calls[0]
    expect(fetchCall).toBeDefined()
    const payload = JSON.parse(fetchCall?.[1].body as string)
    expect(payload.data.amount_minor).toBe(32_000)
    const values = mockDb._qb.values.mock.calls.map((call) => call[0] as Record<string, unknown>)
    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            original_quote_amount_minor: 42_000,
            remaining_balance_minor: 32_000,
          }),
        }),
      ]),
    )
  })

  it('creates a fresh checkout when the stored reference amount is stale', async () => {
    const quote = makeQuote({ contactId: 'contact-001', id: 'quote-001', totalAmount: '420.00' })
    const order = makeOrder({ id: 'order-001', paidAmount: '100.00', quoteId: 'quote-001' })
    acceptMock.mockResolvedValue({ engagementId: 'eng-001', order, quote })
    installAwaitSequence([
      [makeContact({ email: 'client@example.com' })],
      [makeEngagement()],
      [
        {
          externalId: 'co_stale',
          metadata: {
            amount_minor: 42_000,
            checkout_url: 'https://pay.dhan.am/session/co_stale',
            currency: 'USD',
            order_id: 'order-001',
            session_id: 'co_stale',
            status: 'open',
          },
        },
      ],
      [],
      [],
      [],
    ])

    const result = await service().createForQuote({ engagementId: 'eng-001', quoteId: 'quote-001' })

    expect(result.reused).toBe(false)
    expect(result.checkoutUrl).toBe('https://pay.dhan.am/session/co_001')
    expect(fetchMock).toHaveBeenCalled()
  })

  it('creates a fresh checkout when reuse is explicitly disabled', async () => {
    const quote = makeQuote({ contactId: 'contact-001', id: 'quote-001', totalAmount: '420.00' })
    const order = makeOrder({ id: 'order-001', quoteId: 'quote-001' })
    acceptMock.mockResolvedValue({ engagementId: 'eng-001', order, quote })
    installAwaitSequence([
      [makeContact({ email: 'client@example.com' })],
      [makeEngagement()],
      [],
      [],
      [],
    ])

    const result = await service().createForQuote({
      engagementId: 'eng-001',
      quoteId: 'quote-001',
      reuseExistingCheckout: false,
    })

    expect(result.reused).toBe(false)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('fails closed when Dhanam checkout signing is not configured', async () => {
    const quote = makeQuote({ contactId: 'contact-001', id: 'quote-001', totalAmount: '420.00' })
    acceptMock.mockResolvedValue({
      engagementId: 'eng-001',
      order: makeOrder({ id: 'order-001' }),
      quote,
    })
    installAwaitSequence([[makeContact({ email: 'client@example.com' })], [makeEngagement()], []])

    await expect(
      service({ signingSecret: '' }).createForQuote({
        engagementId: 'eng-001',
        quoteId: 'quote-001',
      }),
    ).rejects.toThrow('DHANAM_WEBHOOK_SECRET is not configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects quotes without a positive total before calling Dhanam', async () => {
    const quote = makeQuote({ contactId: 'contact-001', id: 'quote-001', totalAmount: '0.00' })
    acceptMock.mockResolvedValue({
      engagementId: 'eng-001',
      order: makeOrder({ id: 'order-001' }),
      quote,
    })
    installAwaitSequence([[makeContact({ email: 'client@example.com' })], [makeEngagement()]])

    await expect(
      service().createForQuote({ engagementId: 'eng-001', quoteId: 'quote-001' }),
    ).rejects.toThrow('Quote total amount must be greater than zero before checkout')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects fully paid quotes before calling Dhanam', async () => {
    const quote = makeQuote({ contactId: 'contact-001', id: 'quote-001', totalAmount: '420.00' })
    const order = makeOrder({ id: 'order-001', paidAmount: '420.00' })
    acceptMock.mockResolvedValue({
      engagementId: 'eng-001',
      order,
      quote,
    })
    installAwaitSequence([[makeContact({ email: 'client@example.com' })], [makeEngagement()]])

    await expect(
      service().createForQuote({ engagementId: 'eng-001', quoteId: 'quote-001' }),
    ).rejects.toThrow('Quote has no remaining balance before checkout')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  function service(overrides: { signingSecret?: string } = {}) {
    const ctx = createTestContext()
    ctx.mockDb = mockDb
    ctx.db = mockDb as never
    return new DhanamCheckoutService(ctx, {
      appUrl: 'https://phynd.app',
      dhanamApiUrl: 'https://api-staging.dhan.am',
      fetch: fetchMock as never,
      signingSecret:
        'signingSecret' in overrides ? overrides.signingSecret : 'DUMMY_WEBHOOK_SECRET_DO_NOT_USE',
    })
  }

  function installAwaitSequence(results: unknown[][]) {
    let callCount = 0
    mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
      const result = results[callCount] ?? []
      callCount += 1
      return Promise.resolve(result).then(resolve)
    })
  }
})

function makeEngagement(overrides: Record<string, unknown> = {}) {
  return {
    contactId: 'contact-001',
    createdAt: new Date('2025-01-15T10:00:00Z'),
    deletedAt: null,
    description: null,
    id: 'eng-001',
    opportunityId: 'opp-001',
    ownerId: null,
    projectName: 'Retail Kiosk',
    status: 'active',
    updatedAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  }
}

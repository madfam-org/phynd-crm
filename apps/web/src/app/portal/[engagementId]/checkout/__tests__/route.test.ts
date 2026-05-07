import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkoutMock, getDbMock, readSessionMock } = vi.hoisted(() => ({
  checkoutMock: vi.fn(),
  getDbMock: vi.fn(),
  readSessionMock: vi.fn(),
}))

vi.mock('@/lib/portal/session', () => ({
  readAndVerifyPortalSession: readSessionMock,
}))

vi.mock('@phyne/db', () => ({
  getDb: getDbMock,
}))

vi.mock('@phyne/db/schema', () => ({
  contacts: {
    email: 'contacts.email',
    id: 'contacts.id',
  },
  engagements: {
    contactId: 'engagements.contactId',
    deletedAt: 'engagements.deletedAt',
    id: 'engagements.id',
    opportunityId: 'engagements.opportunityId',
  },
  quotes: {
    contactId: 'quotes.contactId',
    deletedAt: 'quotes.deletedAt',
    id: 'quotes.id',
    opportunityId: 'quotes.opportunityId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

vi.mock('@phyne/logging', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
  })),
}))

vi.mock('@phyne/services/payments/dhanam-checkout', () => ({
  DhanamCheckoutService: vi.fn(() => ({
    createForQuote: checkoutMock,
  })),
}))

import { POST } from '../route'

describe('POST /portal/[engagementId]/checkout', () => {
  let db: ReturnType<typeof createMockDb>

  beforeEach(() => {
    vi.clearAllMocks()
    db = createMockDb()
    getDbMock.mockReturnValue(db)
    readSessionMock.mockResolvedValue({
      accessToken: 'janua-token',
      email: 'client@example.com',
      engagementId: 'eng-001',
      expiresAt: Date.now() + 60_000,
      januaUserId: 'janua-001',
    })
    checkoutMock.mockResolvedValue({
      checkoutUrl: 'https://pay.dhan.am/session/co_001',
    })
  })

  it('creates checkout for a portal-owned quote and redirects to Dhanam', async () => {
    installAwaitSequence(db, [
      [
        {
          contactEmail: 'client@example.com',
          contactId: 'contact-001',
          id: 'eng-001',
          opportunityId: 'opp-001',
        },
      ],
      [
        {
          contactId: 'contact-001',
          id: 'quote-001',
          opportunityId: 'opp-001',
        },
      ],
    ])

    const res = await POST(requestWithQuote('quote-001'), {
      params: Promise.resolve({ engagementId: 'eng-001' }),
    })

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('https://pay.dhan.am/session/co_001')
    expect(checkoutMock).toHaveBeenCalledWith({
      cancelUrl: 'http://localhost/portal/eng-001?checkout=cancelled',
      engagementId: 'eng-001',
      quoteId: 'quote-001',
      source: 'portal',
      successUrl: 'http://localhost/portal/eng-001?checkout=success',
    })
  })

  it('redirects to expired when the portal session is missing', async () => {
    readSessionMock.mockResolvedValue(null)

    const res = await POST(requestWithQuote('quote-001'), {
      params: Promise.resolve({ engagementId: 'eng-001' }),
    })

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('http://localhost/portal/expired?reason=no-session')
    expect(checkoutMock).not.toHaveBeenCalled()
  })

  it('does not create checkout for a quote outside the engagement', async () => {
    installAwaitSequence(db, [
      [
        {
          contactEmail: 'client@example.com',
          contactId: 'contact-001',
          id: 'eng-001',
          opportunityId: 'opp-001',
        },
      ],
      [
        {
          contactId: 'other-contact',
          id: 'quote-001',
          opportunityId: 'other-opp',
        },
      ],
    ])

    const res = await POST(requestWithQuote('quote-001'), {
      params: Promise.resolve({ engagementId: 'eng-001' }),
    })

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(
      'http://localhost/portal/eng-001?checkout_error=quote_not_found',
    )
    expect(checkoutMock).not.toHaveBeenCalled()
  })
})

function requestWithQuote(quoteId: string) {
  const form = new FormData()
  form.set('quoteId', quoteId)
  return new Request('http://localhost/portal/eng-001/checkout', {
    body: form,
    method: 'POST',
  })
}

function createMockDb() {
  const qb = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    limit: vi.fn(),
    select: vi.fn(),
    // biome-ignore lint/suspicious/noThenProperty: route DB mock must be awaitable
    then: vi.fn(),
    where: vi.fn(),
  }
  for (const method of ['from', 'innerJoin', 'limit', 'select', 'where']) {
    qb[method as keyof typeof qb].mockReturnValue(qb)
  }
  return {
    _qb: qb,
    select: vi.fn().mockReturnValue(qb),
  }
}

function installAwaitSequence(db: ReturnType<typeof createMockDb>, results: unknown[][]) {
  let callCount = 0
  db._qb.then.mockImplementation((resolve: (value: unknown) => void) => {
    const result = results[callCount] ?? []
    callCount += 1
    return Promise.resolve(result).then(resolve)
  })
}

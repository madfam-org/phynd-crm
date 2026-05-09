import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock modules — must be before imports
// ---------------------------------------------------------------------------

type MockSelectResult = {
  contactId?: string | null
  source?: string
  unsubscribed?: boolean
  email?: string
}

const makeQuery = (rows: MockSelectResult[] = []) => {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    set: vi.fn(() => chain),
    _result: rows,
  }

  Object.defineProperty(chain, 'then', {
    value: vi.fn((resolve: (v: MockSelectResult[]) => void) => Promise.resolve(rows).then(resolve)),
    configurable: true,
    enumerable: false,
  })

  return chain
}

const queryResults = {
  lead: [] as MockSelectResult[],
  contact: [] as MockSelectResult[],
}

const mockDb = {
  select: vi.fn(() => {
    const next =
      queryResults.lead.length > 0 ? queryResults.lead.shift() : queryResults.contact.shift()
    return makeQuery(next ? [next] : [])
  }),
}

vi.mock('@phynd/db', () => ({
  getDb: vi.fn(() => mockDb),
}))

vi.mock('@phynd/db/schema', () => ({
  leads: {
    id: 'leads.id',
    contactId: 'leads.contactId',
    source: 'leads.source',
    unsubscribed: 'leads.unsubscribed',
  },
  contacts: { id: 'contacts.id', email: 'contacts.email' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}))

const mockEmailSend = vi.fn()
vi.mock('@phynd/services/email', () => ({
  EmailService: vi.fn(() => ({ send: mockEmailSend })),
}))

const mockQueueAdd = vi.fn()
const mockQueueClose = vi.fn()
vi.mock('bullmq', () => ({
  Queue: vi.fn(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
}))

vi.mock('../queues', () => ({
  createRedisConnection: vi.fn(() => ({ host: 'localhost' })),
}))

vi.mock('@phynd/logging', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

import { processEmailDrip } from '../processors/email-drip'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processEmailDrip', () => {
  const job = { id: 'job-1', data: { leadId: 'lead-123', step: 0 } } as never

  beforeEach(() => {
    vi.clearAllMocks()
    queryResults.lead = []
    queryResults.contact = []
    process.env.EMAIL_ALLOWLIST_DOMAINS = 'madfam.io, @staging.madfam.io'
    process.env.REDIS_URL = 'redis://localhost:6379/0'
  })

  afterEach(() => {
    delete process.env.EMAIL_ALLOWLIST_DOMAINS
    delete process.env.REDIS_URL
  })

  it('sends allowed drip email and schedules next step', async () => {
    queryResults.lead = [
      {
        contactId: 'contact-9a',
        source: 'tezca_newsletter',
        unsubscribed: false,
      },
    ]
    queryResults.contact = [{ email: 'lead@madfam.io' }]
    mockEmailSend.mockResolvedValue({ id: 'msg-1' })

    await processEmailDrip(job)

    expect(mockEmailSend).toHaveBeenCalledOnce()
    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'lead@madfam.io', subject: expect.any(String) }),
    )
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'drip',
      { leadId: 'lead-123', step: 1 },
      {
        delay: 172800000,
        jobId: 'drip-lead-123-step-1',
      },
    )
    expect(mockQueueClose).toHaveBeenCalledOnce()
  })

  it('skips send when recipient is not allowlisted', async () => {
    queryResults.lead = [
      {
        contactId: 'contact-9b',
        source: 'tezca_newsletter',
        unsubscribed: false,
      },
    ]
    queryResults.contact = [{ email: 'lead@realprospect.com' }]

    await processEmailDrip(job)

    expect(mockEmailSend).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
    expect(mockQueueClose).not.toHaveBeenCalled()
  })

  it('does not error when allowlist env is unset', async () => {
    delete process.env.EMAIL_ALLOWLIST_DOMAINS
    queryResults.lead = [
      {
        contactId: 'contact-9c',
        source: 'tezca_newsletter',
        unsubscribed: false,
      },
    ]
    queryResults.contact = [{ email: 'lead@external.org' }]
    mockEmailSend.mockResolvedValue({ id: 'msg-2' })

    await processEmailDrip(job)

    expect(mockEmailSend).toHaveBeenCalledOnce()
  })

  it('skips leads without contactId', async () => {
    queryResults.lead = [
      { contactId: null as unknown as string, source: 'tezca_newsletter', unsubscribed: false },
    ]

    await processEmailDrip(job)

    expect(mockEmailSend).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })
})

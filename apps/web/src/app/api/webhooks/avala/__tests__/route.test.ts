import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 99 })
vi.mock('@/lib/webhooks/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

vi.mock('@/lib/federation/clients', () => ({
  getCacheManager: () => ({}),
}))

const mockFinishIntakeLead = vi.fn().mockResolvedValue({ ownerId: 'user-default', dueAt: null })
vi.mock('@/lib/webhooks/intake-lead', () => ({
  finishIntakeLead: (...args: unknown[]) => mockFinishIntakeLead(...args),
}))

const mockSendLeadAlert = vi.fn().mockResolvedValue(true)
const mockLeadTierOf = vi.fn().mockResolvedValue('A')
vi.mock('@/lib/webhooks/lead-alert', () => ({
  sendLeadAlert: (...args: unknown[]) => mockSendLeadAlert(...args),
  leadTierOf: (...args: unknown[]) => mockLeadTierOf(...args),
}))

vi.mock('@phynd/config/constants', () => ({
  DEFAULT_TENANT_ID: 'madfam',
}))

// ---------------------------------------------------------------------------
// In-memory stand-in for the database with the behaviour the route relies on:
//   - `db.transaction(cb)`: rows written through the handle become visible to
//     later deliveries only when `cb` resolves; a throw discards them all;
//   - `tx.transaction(cb)`: a savepoint, merged into its parent on success;
//   - `tx.execute(pg_advisory_xact_lock(key))`: waits while another open
//     transaction holds `key`; released when that transaction ends.
// The mocked services write through the handle their context carries, so what
// is committed is exactly what a delivery leaves behind.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
type TableName =
  | 'webhook_events'
  | 'contacts'
  | 'leads'
  | 'notes'
  | 'conversions'
  | 'conversion_updates'
  | 'visitor_sessions'

function emptyTables(): Record<TableName, Row[]> {
  return {
    webhook_events: [],
    contacts: [],
    leads: [],
    notes: [],
    conversions: [],
    conversion_updates: [],
    visitor_sessions: [],
  }
}

const SCHEMA = vi.hoisted(() => ({
  contacts: { id: 'contacts.id', externalJanuaId: 'contacts.external_janua_id' },
  conversions: {
    type: 'conversions.type',
    leadId: 'conversions.lead_id',
    metadata: 'conversions.metadata',
  },
  webhookEvents: {
    id: 'webhook_events.id',
    provider: 'webhook_events.provider',
    payload: 'webhook_events.payload',
  },
}))

vi.mock('@phynd/db/schema', () => SCHEMA)

const store = {
  committed: emptyTables(),
  heldLocks: new Map<string, Promise<void>>(),
  locks: [] as string[],
  transactions: 0,
  rollbacks: 0,
  ids: new Map<string, number>(),
}

function nextId(prefix: string): string {
  const n = (store.ids.get(prefix) ?? 0) + 1
  store.ids.set(prefix, n)
  return `${prefix}-${n}`
}

type SqlFragment = { __sql: string; values: unknown[] }
type Condition = { __and?: unknown[]; __eq?: [unknown, unknown] } | SqlFragment

function sqlValue(condition: { __and?: unknown[] }): string {
  const fragment = (condition.__and ?? []).find(
    (part): part is SqlFragment => typeof part === 'object' && part !== null && 'values' in part,
  )
  return String(fragment?.values[1])
}

class FakeTx {
  staged = emptyTables()
  private releases: Array<() => void> = []

  constructor(private readonly parent: FakeTx | null) {}

  private root(): FakeTx {
    return this.parent ? this.parent.root() : this
  }

  rows(table: TableName): Row[] {
    const below = this.parent ? this.parent.rows(table) : store.committed[table]
    return [...below, ...this.staged[table]]
  }

  stage(table: TableName, row: Row): void {
    this.staged[table].push(row)
  }

  mergeInto(target: Record<TableName, Row[]>): void {
    for (const table of Object.keys(this.staged) as TableName[]) {
      target[table].push(...this.staged[table])
    }
  }

  releaseLocks(): void {
    for (const release of this.releases.splice(0)) release()
  }

  execute = vi.fn(async (query: SqlFragment) => {
    const key = String(query.values[0])
    store.locks.push(key)
    for (;;) {
      const held = store.heldLocks.get(key)
      if (!held) break
      await held
    }
    let release: () => void = () => undefined
    store.heldLocks.set(
      key,
      new Promise<void>((resolve) => {
        release = () => {
          store.heldLocks.delete(key)
          resolve()
        }
      }),
    )
    this.root().releases.push(release)
  })

  select = vi.fn(() => ({
    from: vi.fn((table: unknown) => ({
      where: vi.fn((condition: { __and?: unknown[] }) => ({
        limit: vi.fn(async () => {
          const value = sqlValue(condition)
          if (table === SCHEMA.webhookEvents) {
            return this.rows('webhook_events')
              .filter((row) => (row.payload as Row).event_id === value)
              .map(() => ({ id: 'prior' }))
          }
          if (table === SCHEMA.conversions) {
            return this.rows('conversion_updates')
              .filter((row) => (row.metadata as Row).avala_lead_id === value && row.leadId)
              .map((row) => ({ leadId: row.leadId }))
          }
          return []
        }),
      })),
    })),
  }))

  insert = vi.fn(() => ({
    values: vi.fn(async (value: Row) => {
      this.stage('webhook_events', value)
    }),
  }))

  update = vi.fn((table: unknown) => ({
    set: vi.fn((values: Row) => ({
      where: vi.fn(async (condition: Condition) => {
        if (table !== SCHEMA.conversions) return
        const leadId = ((condition as { __and: Array<{ __eq: [unknown, unknown] }> }).__and[1]
          ?.__eq ?? [])[1]
        mockUpdateConversion(values)
        this.stage('conversion_updates', { leadId, ...values })
      }),
    })),
  }))

  transaction = vi.fn(async (cb: (tx: FakeTx) => Promise<unknown>) => {
    const savepoint = new FakeTx(this)
    const result = await cb(savepoint)
    savepoint.mergeInto(this.staged)
    return result
  })
}

/** The route's fast-path dedup check runs on the database handle itself. */
const rootReader = new FakeTx(null)

const mockDb = {
  select: rootReader.select,
  transaction: vi.fn(async (cb: (tx: FakeTx) => Promise<unknown>) => {
    store.transactions += 1
    const tx = new FakeTx(null)
    try {
      const result = await cb(tx)
      tx.mergeInto(store.committed)
      return result
    } catch (error) {
      store.rollbacks += 1
      throw error
    } finally {
      tx.releaseLocks()
    }
  }),
}

vi.mock('@phynd/db', () => ({
  getDb: () => mockDb,
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ __and: args }),
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  isNotNull: (col: unknown) => ({ __isNotNull: col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sql: String.raw({ raw: strings }, ...values.map((v) => String(v))),
    values,
  }),
}))

const mockUpdateConversion = vi.fn()
const mockGetByEmail = vi.fn()
const mockCreateContact = vi.fn()
const mockGetDefaultPipeline = vi.fn().mockResolvedValue({ id: 'pipeline-1' })
const mockGetStages = vi.fn().mockResolvedValue([{ id: 'stage-1' }])
const mockCreateLead = vi.fn()
const mockRecordConversion = vi.fn().mockResolvedValue({ id: 'conversion-1' })
const mockUpsertSession = vi.fn().mockResolvedValue({ id: 'visitor-session-1' })
const mockRecordPageView = vi.fn().mockResolvedValue({ id: 'page-view-1' })
const mockCreateNote = vi.fn()

type FakeCtx = { db: FakeTx }

vi.mock('@phynd/services', () => ({
  createServiceContext: (db: unknown) => ({ db }),
  withTransaction: (ctx: FakeCtx, tx: FakeTx) => ({ ...ctx, db: tx }),
  ContactsService: vi.fn().mockImplementation((ctx: FakeCtx) => ({
    getByEmail: async (email: string) => {
      await mockGetByEmail(email)
      return ctx.db.rows('contacts').find((row) => row.email === email) ?? null
    },
    create: async (data: Row) => {
      await mockCreateContact(data)
      const row = { id: nextId('contact'), ownerId: null, externalJanuaId: null, ...data }
      ctx.db.stage('contacts', row)
      return row
    },
  })),
  LeadsService: vi.fn().mockImplementation((ctx: FakeCtx) => ({
    // Like the service: the lead and its visitor_to_lead conversion.
    create: async (data: Row) => {
      await mockCreateLead(data)
      const row = { id: nextId('lead'), ...data }
      ctx.db.stage('leads', row)
      ctx.db.stage('conversions', { type: 'visitor_to_lead', leadId: row.id })
      return row
    },
  })),
  PipelinesService: vi.fn().mockImplementation(() => ({
    getDefault: mockGetDefaultPipeline,
    getStages: mockGetStages,
  })),
  ConversionsService: vi.fn().mockImplementation(() => ({
    recordConversion: mockRecordConversion,
  })),
  VisitorTrackingService: vi.fn().mockImplementation((ctx: FakeCtx) => ({
    upsertFromWebhook: async (data: Row) => {
      const result = await mockUpsertSession(data)
      ctx.db.stage('visitor_sessions', { ...data })
      return result
    },
    recordPageView: mockRecordPageView,
  })),
  NotesService: vi.fn().mockImplementation((ctx: FakeCtx) => ({
    create: async (data: Row) => {
      const row = { id: nextId('note'), ...data }
      ctx.db.stage('notes', row)
      // Fails after its insert, like a constraint error on the statement.
      await mockCreateNote(data)
      return row
    },
  })),
}))

import { POST } from '../route'

const SECRET = 'DUMMY_WEBHOOK_SECRET_DO_NOT_USE'
const ORIGINAL_SECRET = process.env.PHYND_CRM_EVENTS_SECRET

function signedRequest(body: string, headerOverride?: string): Request {
  const ts = Math.floor(Date.now() / 1000)
  const hmac = crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex')
  const header = headerOverride ?? `t=${ts},v1=${hmac}`
  return new Request('http://localhost/api/webhooks/avala', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-madfam-signature': header,
      'x-forwarded-for': '10.0.0.1',
    },
    body,
  })
}

function post(event: unknown) {
  return POST(signedRequest(JSON.stringify(event)))
}

function makeLeadEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schema_version: '1',
    event_id: 'avala:lead.captured:lead:lead-1:v1',
    event_type: 'avala.lead.captured',
    source: 'avala',
    occurred_at: '2026-05-26T12:00:00.000Z',
    aggregate: { type: 'lead', id: 'lead-1' },
    payload: {
      lead: {
        id: 'lead-1',
        email: 'lead@example.com',
        name: 'Lead Example',
        source: 'marketing_contact',
        interests: ['demo'],
      },
      attribution: {
        sessionId: 'avala-session-1',
        sourcePage: '/contacto',
      },
      consent: { commercialContact: true },
    },
    ...overrides,
  }
}

function committed(table: TableName): Row[] {
  return store.committed[table]
}

beforeEach(() => {
  process.env.PHYND_CRM_EVENTS_SECRET = SECRET
  store.committed = emptyTables()
  store.heldLocks.clear()
  store.locks = []
  store.transactions = 0
  store.rollbacks = 0
  store.ids.clear()
  mockCheckRateLimit.mockClear().mockResolvedValue({ allowed: true, remaining: 99 })
  mockDb.transaction.mockClear()
  mockUpdateConversion.mockReset()
  mockGetByEmail.mockReset()
  mockCreateContact.mockReset()
  mockGetDefaultPipeline.mockClear().mockResolvedValue({ id: 'pipeline-1' })
  mockGetStages.mockClear().mockResolvedValue([{ id: 'stage-1' }])
  mockCreateLead.mockReset()
  mockRecordConversion.mockClear().mockResolvedValue({ id: 'conversion-1' })
  mockUpsertSession.mockClear().mockResolvedValue({ id: 'visitor-session-1' })
  mockRecordPageView.mockClear().mockResolvedValue({ id: 'page-view-1' })
  mockCreateNote.mockReset()
  mockFinishIntakeLead.mockClear().mockResolvedValue({ ownerId: 'user-default', dueAt: null })
  mockSendLeadAlert.mockClear().mockResolvedValue(true)
  mockLeadTierOf.mockClear().mockResolvedValue('A')
})

afterEach(() => {
  process.env.PHYND_CRM_EVENTS_SECRET = ORIGINAL_SECRET
})

describe('POST /api/webhooks/avala', () => {
  it('returns 503 when PHYND_CRM_EVENTS_SECRET is unset', async () => {
    delete process.env.PHYND_CRM_EVENTS_SECRET
    const res = await post(makeLeadEvent())
    expect(res.status).toBe(503)
  })

  it('returns 401 when the signature is invalid', async () => {
    const res = await POST(signedRequest(JSON.stringify(makeLeadEvent()), 't=1,v1=bad'))
    expect(res.status).toBe(401)
  })

  it('captures Avala lead events as contact, lead, visitor session, conversion, and webhook audit', async () => {
    const res = await post(makeLeadEvent())

    expect(res.status).toBe(200)
    const json = (await res.json()) as { received: boolean; status: string }
    expect(json).toMatchObject({ received: true, status: 'processed' })
    expect(mockCreateContact).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'lead@example.com', name: 'Lead Example' }),
    )
    expect(mockCreateLead).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'contact-1', source: 'marketing_contact' }),
    )
    expect(mockUpsertSession).toHaveBeenCalledWith(
      expect.objectContaining({ externalSessionId: 'avala-session-1', contactId: 'contact-1' }),
    )
    expect(mockUpdateConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'contact-1',
        metadata: expect.objectContaining({
          event_id: 'avala:lead.captured:lead:lead-1:v1',
          source: 'avala',
          avala_lead_id: 'lead-1',
        }),
        visitorSessionId: 'visitor-session-1',
      }),
    )
    expect(mockRecordConversion).not.toHaveBeenCalled()
    expect(committed('webhook_events')).toHaveLength(1)
    expect(committed('webhook_events')[0]).toMatchObject({
      provider: 'avala',
      eventType: 'avala.lead.captured',
    })
    expect(store.transactions).toBe(1)
  })

  describe('first-party context, owner and test traffic (G1, G2, G5)', () => {
    const company = {
      id: 'lead-2',
      email: 'persona@empresa-ficticia.mx',
      name: 'Persona Ficticia',
      source: 'producto-comply',
      leadType: 'COMPANY',
      ecCode: 'EC0000',
      certifierId: '0b6f6b0e-52a5-4c0c-9a53-6f6f2c1d00c1',
      centerId: '0b6f6b0e-52a5-4c0c-9a53-6f6f2c1d00c2',
      interests: ['dc3', 'compliance'],
      message: 'Necesitamos certificar a 20 personas.',
    }
    const companyEvent = (overrides: Partial<Record<string, unknown>> = {}) =>
      makeLeadEvent({
        event_id: 'avala:lead.captured:lead:lead-2:v1',
        payload: {
          lead: company,
          attribution: {
            sessionId: 'avala-session-2',
            sourcePage: '/comply',
            intent: 'request-access',
          },
          consent: { commercialContact: true, capturedAt: '2026-11-19T17:00:00.000Z' },
        },
        ...overrides,
      })

    it('keeps message, lead type, EC code, intent and interests', async () => {
      const res = await post(companyEvent())
      expect(res.status).toBe(200)

      expect(mockCreateLead).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'producto-comply',
          isTest: false,
          attribution: expect.objectContaining({
            lead_type: 'COMPANY',
            ec_code: 'EC0000',
            intent: 'request-access',
            interests: ['dc3', 'compliance'],
            landing_page: '/comply',
          }),
        }),
      )
      expect(committed('notes')).toHaveLength(1)
      expect(committed('notes')[0]).toMatchObject({
        content: 'Message from the Avala form\n\nNecesitamos certificar a 20 personas.',
        entityType: 'contact',
        entityId: 'contact-1',
      })
    })

    it('keeps the consent, certifier id and center id on the lead', async () => {
      await post(companyEvent())
      const lead = committed('leads')[0] as { attribution: Record<string, unknown> }
      expect(lead.attribution).toMatchObject({
        certifier_id: '0b6f6b0e-52a5-4c0c-9a53-6f6f2c1d00c1',
        center_id: '0b6f6b0e-52a5-4c0c-9a53-6f6f2c1d00c2',
        consent_commercial_contact: 'granted',
        consent_captured_at: '2026-11-19T17:00:00.000Z',
      })
      expect(mockUpdateConversion).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            certifier_id: '0b6f6b0e-52a5-4c0c-9a53-6f6f2c1d00c1',
            center_id: '0b6f6b0e-52a5-4c0c-9a53-6f6f2c1d00c2',
          }),
        }),
      )
    })

    it('records a declined consent as not granted, and nothing when the block is absent', async () => {
      const declined = companyEvent()
      ;(declined.payload as Row).consent = { commercialContact: false }
      await post(declined)
      expect(
        (committed('leads')[0] as { attribution: Row }).attribution.consent_commercial_contact,
      ).toBe('not_granted')

      const absent = companyEvent({ event_id: 'avala:lead.captured:lead:lead-3:v1' })
      ;(absent.payload as Row).consent = undefined
      ;(absent.payload as { lead: Row }).lead = { ...company, id: 'lead-3' }
      await post(absent)
      const second = committed('leads')[1] as { attribution: Row }
      expect(second.attribution.consent_commercial_contact).toBeUndefined()
      expect(second.attribution.consent_captured_at).toBeUndefined()
    })

    it('gives the new lead its owner and first-contact task, on the delivery transaction', async () => {
      await post(companyEvent())
      expect(mockFinishIntakeLead).toHaveBeenCalledWith(
        expect.any(FakeTx),
        expect.anything(),
        expect.objectContaining({
          leadId: 'lead-1',
          contactOwnerId: null,
          isTest: false,
          displayName: 'Persona Ficticia',
          feed: 'avala',
        }),
      )
    })

    it('a redelivery of the same event creates no second note', async () => {
      await post(companyEvent())
      const res = await post(companyEvent())
      expect(((await res.json()) as { status: string }).status).toBe('duplicate')
      expect(committed('notes')).toHaveLength(1)
      expect(committed('leads')).toHaveLength(1)
    })

    it('writes no note without a message', async () => {
      await post(makeLeadEvent())
      expect(committed('notes')).toHaveLength(0)
    })

    it('marks a smoke lead as test traffic and opens no task for it', async () => {
      const event = makeLeadEvent({
        payload: { lead: { ...company, source: 'provisioning_smoke' }, attribution: {} },
      })
      await post(event)
      expect(mockCreateLead).toHaveBeenCalledWith(expect.objectContaining({ isTest: true }))
      expect(mockFinishIntakeLead).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ isTest: true }),
      )
    })
  })

  describe('new-lead alert', () => {
    it('alerts once after commit, with source and tier', async () => {
      const event = makeLeadEvent()
      ;(event.payload as { lead: Row }).lead.email = 'compras@empresa-ficticia.mx'
      await post(event)
      expect(mockSendLeadAlert).toHaveBeenCalledTimes(1)
      expect(mockSendLeadAlert).toHaveBeenCalledWith({
        feed: 'avala',
        sourceLabel: 'Avala · marketing_contact',
        leadId: 'lead-1',
        contactId: 'contact-1',
        tier: 'A',
        isTest: false,
      })
      // The alert is sent only once the rows are committed.
      expect(committed('leads')).toHaveLength(1)
    })

    it('passes the test flag through, so a test lead is not alerted', async () => {
      const event = makeLeadEvent()
      ;(event.payload as { lead: Row }).lead.source = 'provisioning_smoke'
      await post(event)
      expect(mockSendLeadAlert).toHaveBeenCalledWith(expect.objectContaining({ isTest: true }))
    })

    it('does not alert for a duplicate or a failed delivery', async () => {
      mockCreateNote.mockRejectedValueOnce(new Error('note insert failed'))
      const event = makeLeadEvent()
      ;(event.payload as { lead: Row }).lead.message = 'Hola'
      expect((await post(event)).status).toBe(500)
      expect(mockSendLeadAlert).not.toHaveBeenCalled()

      expect((await post(event)).status).toBe(200)
      expect((await post(event)).status).toBe(200)
      expect(mockSendLeadAlert).toHaveBeenCalledTimes(1)
    })

    it('sends no alert for a non-lead event', async () => {
      await post(
        makeLeadEvent({
          event_id: 'avala:visitor:1',
          event_type: 'avala.visitor.page_viewed',
          payload: { sessionId: 'avala-session-1', url: '/explorar' },
        }),
      )
      expect(mockSendLeadAlert).not.toHaveBeenCalled()
    })
  })

  describe('idempotency', () => {
    const withMessage = () => {
      const event = makeLeadEvent()
      ;(event.payload as { lead: Row }).lead.message = 'Quiero una demo.'
      return event
    }

    it('a failure after the lead is created rolls the whole delivery back; the retry creates exactly one lead', async () => {
      // The note insert fails after the contact and the lead were written.
      mockCreateNote.mockRejectedValueOnce(new Error('note insert failed'))

      const first = await post(withMessage())
      expect(first.status).toBe(500)
      expect(mockCreateLead).toHaveBeenCalledTimes(1)
      expect(store.rollbacks).toBe(1)
      expect(committed('leads')).toHaveLength(0)
      expect(committed('contacts')).toHaveLength(0)
      expect(committed('notes')).toHaveLength(0)
      expect(committed('visitor_sessions')).toHaveLength(0)
      expect(committed('webhook_events')).toHaveLength(0)

      // Avala retries the same delivery.
      const retry = await post(withMessage())
      expect(retry.status).toBe(200)
      expect(((await retry.json()) as { status: string }).status).toBe('processed')
      expect(committed('leads')).toHaveLength(1)
      expect(committed('contacts')).toHaveLength(1)
      expect(committed('notes')).toHaveLength(1)
      expect(committed('webhook_events')).toHaveLength(1)

      // A further retry (Avala did not see the 200) is a duplicate.
      const again = await post(withMessage())
      expect(((await again.json()) as { status: string }).status).toBe('duplicate')
      expect(committed('leads')).toHaveLength(1)
    })

    it('a failure in the webhook audit insert also rolls the lead back', async () => {
      const original = mockDb.transaction.getMockImplementation()
      mockDb.transaction.mockImplementationOnce(async (cb) =>
        original?.(async (inner: FakeTx) => {
          inner.insert = vi.fn(() => ({
            values: vi.fn(async () => {
              throw new Error('webhook_events insert failed')
            }),
          }))
          return cb(inner)
        }),
      )
      expect((await post(makeLeadEvent())).status).toBe(500)
      expect(committed('leads')).toHaveLength(0)

      expect((await post(makeLeadEvent())).status).toBe(200)
      expect(committed('leads')).toHaveLength(1)
      expect(committed('webhook_events')).toHaveLength(1)
    })

    it('two concurrent copies of one delivery create one lead', async () => {
      const [a, b] = await Promise.all([post(makeLeadEvent()), post(makeLeadEvent())])
      const statuses = await Promise.all([a.json(), b.json()]).then((bodies) =>
        bodies.map((body) => (body as { status: string }).status).sort(),
      )
      expect(statuses).toEqual(['duplicate', 'processed'])
      expect(committed('leads')).toHaveLength(1)
      expect(committed('webhook_events')).toHaveLength(1)
    })

    it('the same Avala lead re-emitted under a new event id creates no second lead', async () => {
      await post(makeLeadEvent())
      const res = await post(makeLeadEvent({ event_id: 'avala:lead.captured:lead:lead-1:v2' }))
      expect(res.status).toBe(200)
      expect(committed('leads')).toHaveLength(1)
      // Still recorded, so the event is not reprocessed later.
      expect(committed('webhook_events')).toHaveLength(2)
      expect(mockSendLeadAlert).toHaveBeenCalledTimes(1)
    })

    it('serializes on the event id, then the Avala lead id, then the email', async () => {
      await post(makeLeadEvent())
      expect(store.locks).toEqual([
        'phynd:avala:event:avala:lead.captured:lead:lead-1:v1',
        'phynd:avala:lead:lead-1',
        'phynd:avala:email:lead@example.com',
      ])
    })
  })
})

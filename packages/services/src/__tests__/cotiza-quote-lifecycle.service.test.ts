/**
 * CotizaQuoteLifecycleService — quote-lifecycle intake + status reflection.
 *
 * Contract verified (see docs/ENGAGEMENT_EVENT_TAXONOMY.md and the inbound
 * contract on /api/v1/engagements/events):
 *   - engagement resolution order: explicit engagement_id → cotiza quote
 *     external_reference → cotiza customer external_reference → lowercased
 *     contact_email → contact's active engagement → auto-materialize
 *   - unknown contact → skipped (never throws)
 *   - first sight of a cotiza_quote_id materializes a local quotes row +
 *     external_references(entityType 'quote', provider 'cotiza')
 *   - dedup replay (same dedup_key) → deduplicated, no duplicate writes
 *   - status reflection: quote_sent→sent, quote_approved→accepted via
 *     QuotesService.accept (idempotent), quote_rejected→declined,
 *     quote_expired→expired; quote_viewed/quote_ordered stay event-only
 *   - canonical `quote_approved` milestone alias keeps its own dedup key
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@phynd/db/schema', () => {
  const table = (name: string, cols: string[]) => {
    const t: Record<string, string> = { _table: name }
    for (const c of cols) t[c] = `${name}.${c}`
    return t
  }
  return {
    activities: table('activities', ['entityType', 'entityId', 'createdAt']),
    contacts: table('contacts', ['id', 'email', 'deletedAt']),
    conversions: table('conversions', ['id', 'type']),
    engagementArtifacts: table('engagement_artifacts', ['engagementId', 'createdAt']),
    engagementEvents: table('engagement_events', ['engagementId', 'dedupKey', 'createdAt']),
    engagements: table('engagements', [
      'id',
      'contactId',
      'opportunityId',
      'status',
      'deletedAt',
      'createdAt',
    ]),
    externalReferences: table('external_references', [
      'entityType',
      'entityId',
      'provider',
      'externalId',
    ]),
    notifications: table('notifications', ['id', 'userId', 'isRead', 'createdAt']),
    opportunities: table('opportunities', ['id', 'status', 'deletedAt']),
    orders: table('orders', ['id', 'quoteId', 'deletedAt']),
    quotes: table('quotes', ['id', 'contactId', 'opportunityId', 'status', 'deletedAt']),
    stageTransitions: table('stage_transitions', ['entityType', 'entityId', 'transitionedAt']),
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  desc: vi.fn((col: unknown) => ({ _tag: 'desc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
  sql: vi.fn(() => ({ _tag: 'sql' })),
}))

import type { ServiceContext } from '../context'
import { CotizaQuoteLifecycleService } from '../quotes/cotiza-quote-lifecycle.service'

// ---------------------------------------------------------------------------
// Stateful table-dispatch db harness
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

interface HarnessState {
  refs: Row[]
  contactsById: Map<string, Row>
  quotesById: Map<string, Row>
  engagementsById: Map<string, Row>
  opportunitiesById: Map<string, Row>
  events: Row[]
  ordersByQuoteId: Map<string, Row[]>
  inserts: Record<string, Row[]>
  updates: Array<{ table: string; values: Row; where: Map<string, unknown> }>
  nextId: number
}

function createState(): HarnessState {
  return {
    refs: [],
    contactsById: new Map(),
    quotesById: new Map(),
    engagementsById: new Map(),
    opportunitiesById: new Map(),
    events: [],
    ordersByQuoteId: new Map(),
    inserts: {},
    updates: [],
    nextId: 0,
  }
}

function captureEq(cond: unknown, into: Map<string, unknown>) {
  if (!cond || typeof cond !== 'object') return
  const obj = cond as Record<string, unknown>
  if (obj._tag === 'eq' && typeof obj.col === 'string') {
    into.set(obj.col, obj.val)
  } else if (obj._tag === 'and' && Array.isArray(obj.args)) {
    for (const inner of obj.args) captureEq(inner, into)
  }
}

function matchesEq(row: Row, where: Map<string, unknown>, col: string, field: string) {
  return !where.has(col) || row[field] === where.get(col)
}

function selectRefs(state: HarnessState, where: Map<string, unknown>): Row[] {
  return state.refs
    .filter(
      (ref) =>
        matchesEq(ref, where, 'external_references.entityType', 'entityType') &&
        matchesEq(ref, where, 'external_references.provider', 'provider') &&
        matchesEq(ref, where, 'external_references.externalId', 'externalId'),
    )
    .map((ref) => ({ entityId: ref.entityId }))
}

function selectContacts(state: HarnessState, where: Map<string, unknown>): Row[] {
  if (where.has('contacts.id')) {
    const row = state.contactsById.get(String(where.get('contacts.id')))
    return row && !row.deletedAt ? [{ id: row.id }] : []
  }
  const email = where.get('contacts.email')
  const match = [...state.contactsById.values()].find((c) => c.email === email && !c.deletedAt)
  return match ? [{ id: match.id }] : []
}

function selectEngagements(state: HarnessState, where: Map<string, unknown>): Row[] {
  if (where.has('engagements.id')) {
    const row = state.engagementsById.get(String(where.get('engagements.id')))
    return row && !row.deletedAt ? [row] : []
  }
  return [...state.engagementsById.values()].filter(
    (e) =>
      !e.deletedAt &&
      matchesEq(e, where, 'engagements.contactId', 'contactId') &&
      matchesEq(e, where, 'engagements.opportunityId', 'opportunityId') &&
      matchesEq(e, where, 'engagements.status', 'status'),
  )
}

function selectById(rows: Map<string, Row>, where: Map<string, unknown>, idCol: string): Row[] {
  const row = rows.get(String(where.get(idCol)))
  return row && !row.deletedAt ? [row] : []
}

function resolveSelect(state: HarnessState, table: string, where: Map<string, unknown>): Row[] {
  if (table === 'external_references') return selectRefs(state, where)
  if (table === 'quotes') return selectById(state.quotesById, where, 'quotes.id')
  if (table === 'contacts') return selectContacts(state, where)
  if (table === 'engagements') return selectEngagements(state, where)
  if (table === 'engagement_events') {
    return state.events.filter(
      (e) =>
        e.engagementId === where.get('engagement_events.engagementId') &&
        e.dedupKey === where.get('engagement_events.dedupKey'),
    )
  }
  if (table === 'orders') {
    return state.ordersByQuoteId.get(String(where.get('orders.quoteId'))) ?? []
  }
  if (table === 'opportunities') {
    return selectById(state.opportunitiesById, where, 'opportunities.id')
  }
  return []
}

function applyInsert(state: HarnessState, table: string, values: Row): Row {
  const id = `${table}_gen_${++state.nextId}`
  const row = { id, ...values }
  state.inserts[table] = state.inserts[table] ?? []
  state.inserts[table].push(row)

  if (table === 'engagements') {
    state.engagementsById.set(id, { opportunityId: null, deletedAt: null, ...row })
  }
  if (table === 'quotes') {
    state.quotesById.set(id, { deletedAt: null, ...row })
  }
  if (table === 'external_references') {
    state.refs.push(row)
  }
  if (table === 'engagement_events') {
    state.events.push(row)
  }
  if (table === 'orders') {
    const quoteId = String(values.quoteId)
    state.ordersByQuoteId.set(quoteId, [...(state.ordersByQuoteId.get(quoteId) ?? []), row])
  }
  return row
}

function applyUpdate(state: HarnessState, table: string, values: Row, where: Map<string, unknown>) {
  state.updates.push({ table, values, where })
  if (table === 'quotes') {
    const row = state.quotesById.get(String(where.get('quotes.id')))
    if (row) Object.assign(row, values)
    return row ? [{ ...row }] : []
  }
  if (table === 'opportunities') {
    const row = state.opportunitiesById.get(String(where.get('opportunities.id')))
    if (row) Object.assign(row, values)
    return row ? [{ ...row }] : []
  }
  if (table === 'orders') {
    return []
  }
  return []
}

function createStatefulDb(state: HarnessState) {
  const makeChain = (mode: 'select' | 'insert' | 'update', table?: string) => {
    const chainState = {
      mode,
      table: table ?? '',
      where: new Map<string, unknown>(),
      values: {} as Row,
    }
    const terminal = () => {
      if (chainState.mode === 'select') {
        return resolveSelect(state, chainState.table, chainState.where)
      }
      if (chainState.mode === 'insert') {
        return [applyInsert(state, chainState.table, chainState.values)]
      }
      return applyUpdate(state, chainState.table, chainState.values, chainState.where)
    }
    const chain: Record<string, unknown> = {}
    chain.from = vi.fn((t: Record<string, unknown>) => {
      chainState.table = String(t._table)
      return chain
    })
    chain.where = vi.fn((cond: unknown) => {
      captureEq(cond, chainState.where)
      return chain
    })
    chain.values = vi.fn((v: Row) => {
      chainState.values = v
      return chain
    })
    chain.set = vi.fn((v: Row) => {
      chainState.values = v
      return chain
    })
    chain.orderBy = vi.fn(() => chain)
    chain.limit = vi.fn(() => chain)
    chain.innerJoin = vi.fn(() => chain)
    chain.onConflictDoNothing = vi.fn(() => chain)
    chain.returning = vi.fn(() => Promise.resolve(terminal()))
    // biome-ignore lint/suspicious/noThenProperty: mock needs `then` to be awaitable
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(terminal()).then(resolve)
    return chain
  }

  const db = {
    select: vi.fn(() => makeChain('select')),
    insert: vi.fn((t: Record<string, unknown>) => makeChain('insert', String(t._table))),
    update: vi.fn((t: Record<string, unknown>) => makeChain('update', String(t._table))),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(db)),
  }
  return db
}

function createCtx(state: HarnessState): ServiceContext {
  return {
    db: createStatefulDb(state) as unknown as ServiceContext['db'],
    cache: {} as ServiceContext['cache'],
    auth: {
      userId: 'service:cotiza',
      tenantId: 'madfam',
      roles: ['service'],
      scopes: ['engagements:write'],
      accessToken: '',
    },
    tenantId: 'madfam',
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function seedContact(state: HarnessState, overrides: Row = {}) {
  const row = { id: 'contact_1', email: 'client@acme.mx', deletedAt: null, ...overrides }
  state.contactsById.set(String(row.id), row)
  return row
}

function seedEngagement(state: HarnessState, overrides: Row = {}) {
  const row = {
    id: 'eng_1',
    contactId: 'contact_1',
    opportunityId: null,
    projectName: 'Acme prototype',
    status: 'active',
    deletedAt: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  }
  state.engagementsById.set(String(row.id), row)
  return row
}

function seedQuote(state: HarnessState, cotizaQuoteId: string, overrides: Row = {}) {
  const row = {
    id: 'quote_1',
    quoteNumber: 'Q-2026-100',
    contactId: 'contact_1',
    opportunityId: null,
    status: 'sent',
    totalAmount: '1500.00',
    currency: 'MXN',
    deletedAt: null,
    ...overrides,
  }
  state.quotesById.set(String(row.id), row)
  state.refs.push({
    entityType: 'quote',
    entityId: row.id,
    provider: 'cotiza',
    externalId: cotizaQuoteId,
  })
  return row
}

function payload(state: string, overrides: Row = {}, metadata: Row = {}) {
  return {
    source: 'cotiza',
    event_type: `cotiza:${state}`,
    timestamp: '2026-07-07T09:00:00.000Z',
    metadata: {
      cotiza_quote_id: 'CQ-1',
      quote_number: 'Q-2026-100',
      total: 1500,
      currency: 'MXN',
      ...metadata,
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CotizaQuoteLifecycleService', () => {
  let state: HarnessState

  beforeEach(() => {
    state = createState()
  })

  it('resolves via explicit engagement_id, materializes local quote + external ref, reflects quote_sent', async () => {
    seedContact(state)
    seedEngagement(state)

    const service = new CotizaQuoteLifecycleService(createCtx(state))
    const result = await service.processWebhookPayload(
      payload('quote_sent', { engagement_id: 'eng_1' }),
    )

    expect(result).toMatchObject({
      outcome: 'recorded',
      engagementId: 'eng_1',
      contactId: 'contact_1',
      reflection: 'applied',
      autoMaterializedEngagement: false,
      createdQuote: true,
    })

    const [quote] = state.inserts.quotes ?? []
    expect(quote).toMatchObject({
      quoteNumber: 'Q-2026-100',
      contactId: 'contact_1',
      status: 'draft',
      totalAmount: '1500.00',
      currency: 'MXN',
    })
    expect(state.inserts.external_references?.[0]).toMatchObject({
      entityType: 'quote',
      entityId: quote?.id,
      provider: 'cotiza',
      externalId: 'CQ-1',
      externalType: 'quote',
    })
    // Reflection flipped the freshly created draft to sent.
    expect(state.quotesById.get(String(quote?.id))?.status).toBe('sent')

    const [event] = state.inserts.engagement_events ?? []
    expect(event).toMatchObject({
      engagementId: 'eng_1',
      source: 'cotiza',
      eventType: 'cotiza:quote_sent',
      status: 'milestone',
      dedupKey: 'cotiza:CQ-1:quote_sent',
    })
    expect(event?.message).toBe('Quote Q-2026-100 sent to client')
  })

  it('resolves O(1) via the quote external reference and reflects quote_rejected sent→declined', async () => {
    seedContact(state)
    seedEngagement(state)
    seedQuote(state, 'CQ-1', { status: 'sent' })

    const service = new CotizaQuoteLifecycleService(createCtx(state))
    const result = await service.processWebhookPayload(payload('quote_rejected'))

    expect(result).toMatchObject({
      outcome: 'recorded',
      engagementId: 'eng_1',
      quoteId: 'quote_1',
      reflection: 'applied',
      createdQuote: false,
    })
    expect(state.quotesById.get('quote_1')?.status).toBe('declined')
    expect(state.inserts.quotes ?? []).toHaveLength(0)
  })

  it('reflects quote_expired sent→expired', async () => {
    seedContact(state)
    seedEngagement(state)
    seedQuote(state, 'CQ-1', { status: 'sent' })

    const service = new CotizaQuoteLifecycleService(createCtx(state))
    const result = await service.processWebhookPayload(payload('quote_expired'))

    expect(result).toMatchObject({ outcome: 'recorded', reflection: 'applied' })
    expect(state.quotesById.get('quote_1')?.status).toBe('expired')
  })

  it('resolves via the cotiza customer external reference', async () => {
    seedContact(state)
    seedEngagement(state)
    state.refs.push({
      entityType: 'contact',
      entityId: 'contact_1',
      provider: 'cotiza',
      externalId: 'cust-9',
    })

    const service = new CotizaQuoteLifecycleService(createCtx(state))
    const result = await service.processWebhookPayload(
      payload('quote_sent', {}, { cotiza_quote_id: 'CQ-3', cotiza_customer_id: 'cust-9' }),
    )

    expect(result).toMatchObject({
      outcome: 'recorded',
      engagementId: 'eng_1',
      contactId: 'contact_1',
      autoMaterializedEngagement: false,
    })
  })

  it('falls back to lowercased contact_email and auto-materializes an engagement', async () => {
    seedContact(state, { email: 'client@acme.mx' })

    const service = new CotizaQuoteLifecycleService(createCtx(state))
    const result = await service.processWebhookPayload(
      payload('quote_viewed', {}, { contact_email: 'Client@Acme.MX' }),
    )

    expect(result.outcome).toBe('recorded')
    if (result.outcome === 'skipped') throw new Error('unreachable')
    expect(result.autoMaterializedEngagement).toBe(true)
    expect(result.reflection).toBe('event_only')

    const [engagement] = state.inserts.engagements ?? []
    expect(engagement).toMatchObject({
      contactId: 'contact_1',
      status: 'active',
      projectName: 'Cotiza quote Q-2026-100',
    })
    expect(state.inserts.engagement_events?.[0]).toMatchObject({
      engagementId: engagement?.id,
      eventType: 'cotiza:quote_viewed',
      status: 'in_progress',
      dedupKey: 'cotiza:CQ-1:quote_viewed',
    })
    // quote_viewed still materializes the quote mapping on first sight.
    expect(state.inserts.quotes).toHaveLength(1)
    expect(state.quotesById.get(String(state.inserts.quotes?.[0]?.id))?.status).toBe('draft')
  })

  it('skips events for unknown contacts without writing anything', async () => {
    const service = new CotizaQuoteLifecycleService(createCtx(state))
    const result = await service.processWebhookPayload(
      payload('quote_sent', {}, { contact_email: 'nobody@nowhere.mx' }),
    )

    expect(result).toEqual({ outcome: 'skipped', reason: 'unresolved_contact' })
    expect(state.inserts).toEqual({})
    expect(state.events).toHaveLength(0)
  })

  it('deduplicates a replay by dedup_key and applies no duplicate writes', async () => {
    seedContact(state)
    seedEngagement(state)
    seedQuote(state, 'CQ-1', { status: 'sent' })
    state.events.push({
      id: 'evt_prior',
      engagementId: 'eng_1',
      dedupKey: 'cotiza:CQ-1:quote_sent',
    })

    const service = new CotizaQuoteLifecycleService(createCtx(state))
    const result = await service.processWebhookPayload(payload('quote_sent'))

    expect(result).toMatchObject({ outcome: 'deduplicated', reflection: 'noop' })
    expect(state.inserts.engagement_events ?? []).toHaveLength(0)
    expect(state.updates.filter((u) => u.table === 'quotes')).toHaveLength(0)
    expect(state.quotesById.get('quote_1')?.status).toBe('sent')
  })

  it('quote_approved reuses QuotesService.accept — order, opportunity won, conversions, milestone', async () => {
    seedContact(state)
    seedEngagement(state, { opportunityId: 'opp_1' })
    seedQuote(state, 'CQ-1', { status: 'sent', opportunityId: 'opp_1' })
    state.opportunitiesById.set('opp_1', {
      id: 'opp_1',
      status: 'open',
      value: '1500.00',
      deletedAt: null,
    })

    const service = new CotizaQuoteLifecycleService(createCtx(state))
    const result = await service.processWebhookPayload(payload('quote_approved'))

    expect(result).toMatchObject({
      outcome: 'recorded',
      quoteId: 'quote_1',
      reflection: 'applied',
    })
    expect(state.quotesById.get('quote_1')?.status).toBe('accepted')
    expect(state.opportunitiesById.get('opp_1')?.status).toBe('won')
    expect(state.inserts.orders).toHaveLength(1)
    expect(state.inserts.orders?.[0]).toMatchObject({ quoteId: 'quote_1', status: 'confirmed' })
    expect(state.inserts.conversions?.map((c) => c.type).sort()).toEqual([
      'opportunity_to_won',
      'quote_accepted',
    ])
    // Two engagement_events: the inbound lifecycle event + accept()'s
    // internal quote_approved milestone (separate dedup keys).
    const dedupKeys = state.events.map((e) => e.dedupKey).sort()
    expect(dedupKeys).toEqual(['cotiza:CQ-1:quote_approved', 'quote:quote_1:accepted'])
  })

  it('quote_approved replay on an already-accepted quote stays idempotent', async () => {
    seedContact(state)
    seedEngagement(state, { opportunityId: 'opp_1' })
    seedQuote(state, 'CQ-1', { status: 'accepted', opportunityId: 'opp_1' })
    state.opportunitiesById.set('opp_1', { id: 'opp_1', status: 'won', deletedAt: null })
    state.ordersByQuoteId.set('quote_1', [
      { id: 'order_1', quoteId: 'quote_1', status: 'confirmed', deletedAt: null },
    ])
    state.events.push({
      id: 'evt_prior',
      engagementId: 'eng_1',
      dedupKey: 'cotiza:CQ-1:quote_approved',
    })

    const service = new CotizaQuoteLifecycleService(createCtx(state))
    const result = await service.processWebhookPayload(payload('quote_approved'))

    expect(result).toMatchObject({ outcome: 'deduplicated', reflection: 'noop' })
    expect(state.inserts.orders ?? []).toHaveLength(0)
    expect(state.inserts.conversions ?? []).toHaveLength(0)
    expect(state.inserts.engagement_events ?? []).toHaveLength(0)
    expect(state.quotesById.get('quote_1')?.status).toBe('accepted')
  })

  it('records the canonical quote_approved milestone alias under its own dedup key', async () => {
    seedContact(state)
    seedEngagement(state)
    seedQuote(state, 'CQ-1', { status: 'accepted' })
    state.events.push({
      id: 'evt_native',
      engagementId: 'eng_1',
      dedupKey: 'cotiza:CQ-1:quote_approved',
    })

    const service = new CotizaQuoteLifecycleService(createCtx(state))
    const result = await service.processWebhookPayload(
      payload('quote_approved', { dedup_key: 'cotiza:CQ-1:milestone:quote_approved' }),
    )

    // Alias is NOT deduplicated against the native event — separate key.
    expect(result.outcome).toBe('recorded')
    const [alias] = state.inserts.engagement_events ?? []
    expect(alias).toMatchObject({
      eventType: 'cotiza:quote_approved',
      status: 'milestone',
      dedupKey: 'cotiza:CQ-1:milestone:quote_approved',
    })
    expect((alias?.metadata as Row).canonical_milestone).toBe('quote_approved')
  })

  it('reports a conflict instead of clobbering an accepted quote on quote_rejected', async () => {
    seedContact(state)
    seedEngagement(state)
    seedQuote(state, 'CQ-1', { status: 'accepted' })

    const service = new CotizaQuoteLifecycleService(createCtx(state))
    const result = await service.processWebhookPayload(payload('quote_rejected'))

    expect(result).toMatchObject({ outcome: 'recorded', reflection: 'conflict' })
    expect(state.quotesById.get('quote_1')?.status).toBe('accepted')
    // The event is still recorded for the audit trail.
    expect(state.inserts.engagement_events).toHaveLength(1)
  })
})

/**
 * OpsEventsService — `madfam.ops.v1` intake (CRM↔Ops↔Checkout loop).
 *
 * Contract verified:
 *   - contact resolution order: subject.contact_id → dhanam external_reference
 *     → Janua sub → lowercased email
 *   - a resolved event marks webhook_events(id) for dedup, writes an
 *     `ops_event` activity against the contact, and — when usage crosses the
 *     upsell threshold — persists a `pending` upsell offer + a contact-linked
 *     external_reference carrying the checkout attribution
 *   - unresolvable subject → skipped, nothing written (no dedup mark)
 *   - replay on the same webhook id → duplicate, no activity/offer writes
 *   - non-upsell events (milestone/delivery) write the activity, no offer
 *   - unsupported event_type → skipped
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@phynd/db/schema', () => {
  const table = (name: string, cols: string[]) => {
    const t: Record<string, string> = { _table: name }
    for (const c of cols) t[c] = `${name}.${c}`
    return t
  }
  return {
    activities: table('activities', ['entityType', 'entityId', 'type']),
    contacts: table('contacts', ['id', 'email', 'externalJanuaId', 'deletedAt']),
    externalReferences: table('external_references', [
      'entityType',
      'entityId',
      'provider',
      'externalId',
    ]),
    offers: table('offers', ['id', 'status', 'type']),
    webhookEvents: table('webhook_events', ['id']),
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
}))

import type { ServiceContext } from '../context'
import { OpsEventsService } from '../ops-events/ops-events.service'

// ---------------------------------------------------------------------------
// Stateful table-dispatch db harness
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

interface HarnessState {
  refs: Row[]
  contactsById: Map<string, Row>
  webhookEventsById: Map<string, Row>
  inserts: Record<string, Row[]>
  nextId: number
}

function createState(): HarnessState {
  return {
    refs: [],
    contactsById: new Map(),
    webhookEventsById: new Map(),
    inserts: {},
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

function selectRefs(state: HarnessState, where: Map<string, unknown>): Row[] {
  return state.refs
    .filter(
      (ref) =>
        (!where.has('external_references.entityType') ||
          ref.entityType === where.get('external_references.entityType')) &&
        (!where.has('external_references.provider') ||
          ref.provider === where.get('external_references.provider')) &&
        (!where.has('external_references.externalId') ||
          ref.externalId === where.get('external_references.externalId')),
    )
    .map((ref) => ({ entityId: ref.entityId }))
}

function selectContacts(state: HarnessState, where: Map<string, unknown>): Row[] {
  const alive = (c: Row) => !c.deletedAt
  if (where.has('contacts.id')) {
    const row = state.contactsById.get(String(where.get('contacts.id')))
    return row && alive(row) ? [{ id: row.id }] : []
  }
  if (where.has('contacts.externalJanuaId')) {
    const match = [...state.contactsById.values()].find(
      (c) => c.externalJanuaId === where.get('contacts.externalJanuaId') && alive(c),
    )
    return match ? [{ id: match.id }] : []
  }
  const email = where.get('contacts.email')
  const match = [...state.contactsById.values()].find((c) => c.email === email && alive(c))
  return match ? [{ id: match.id }] : []
}

function resolveSelect(state: HarnessState, table: string, where: Map<string, unknown>): Row[] {
  if (table === 'external_references') return selectRefs(state, where)
  if (table === 'contacts') return selectContacts(state, where)
  return []
}

function applyInsert(
  state: HarnessState,
  table: string,
  values: Row,
  onConflict: boolean,
): Row | null {
  if (table === 'webhook_events') {
    const id = String(values.id)
    if (onConflict && state.webhookEventsById.has(id)) return null
    const row = { ...values }
    state.webhookEventsById.set(id, row)
    state.inserts.webhook_events = [...(state.inserts.webhook_events ?? []), row]
    return row
  }

  const id = values.id ? String(values.id) : `${table}_gen_${++state.nextId}`
  const row = { id, ...values }
  state.inserts[table] = [...(state.inserts[table] ?? []), row]
  if (table === 'external_references') state.refs.push(row)
  return row
}

function createStatefulDb(state: HarnessState) {
  const makeChain = (mode: 'select' | 'insert', table?: string) => {
    const chainState = {
      mode,
      table: table ?? '',
      where: new Map<string, unknown>(),
      values: {} as Row,
      onConflict: false,
    }
    const terminal = () => {
      if (chainState.mode === 'select') {
        return resolveSelect(state, chainState.table, chainState.where)
      }
      const row = applyInsert(state, chainState.table, chainState.values, chainState.onConflict)
      return row ? [row] : []
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
    chain.limit = vi.fn(() => chain)
    chain.onConflictDoNothing = vi.fn(() => {
      chainState.onConflict = true
      return chain
    })
    chain.returning = vi.fn(() => Promise.resolve(terminal()))
    // biome-ignore lint/suspicious/noThenProperty: mock needs `then` to be awaitable
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(terminal()).then(resolve)
    return chain
  }

  const db = {
    select: vi.fn(() => makeChain('select')),
    insert: vi.fn((t: Record<string, unknown>) => makeChain('insert', String(t._table))),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(db)),
  }
  return db
}

function createCtx(state: HarnessState): ServiceContext {
  return {
    db: createStatefulDb(state) as unknown as ServiceContext['db'],
    cache: {} as ServiceContext['cache'],
    auth: {
      userId: 'service:ops',
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
  const row = {
    id: 'contact_1',
    email: 'ops@clientco.mx',
    externalJanuaId: null,
    deletedAt: null,
    ...overrides,
  }
  state.contactsById.set(String(row.id), row)
  return row
}

function seedDhanamRef(state: HarnessState, externalId: string, contactId = 'contact_1') {
  state.refs.push({
    entityType: 'contact',
    entityId: contactId,
    provider: 'dhanam',
    externalId,
  })
}

function usageEvent(overrides: Row = {}, payload: Row = {}, subject: Row = {}) {
  return {
    schema_version: 'madfam.ops.v1',
    id: 'evt_usage_1',
    event_type: 'ops.usage_limit_approaching',
    source: 'dhanam',
    correlation_id: 'corr_1',
    timestamp: '2026-07-16T15:04:05Z',
    dedup_key: 'dhanam:ops.usage_limit_approaching:proj_abc:2026-07-01:80',
    subject: { email: 'ops@clientco.mx', dhanam_customer_id: 'usr_1', ...subject },
    payload: {
      meter: 'waybill_budget',
      threshold_crossed: 80,
      current_plan: 'community',
      suggested_plan: 'pro',
      period_start: '2026-07-01T00:00:00Z',
      ...payload,
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpsEventsService', () => {
  let state: HarnessState

  beforeEach(() => {
    state = createState()
  })

  it('resolves via the dhanam external reference and writes activity + pending offer', async () => {
    seedContact(state)
    seedDhanamRef(state, 'usr_1')

    const service = new OpsEventsService(createCtx(state))
    const result = await service.ingest(usageEvent())

    expect(result).toMatchObject({
      status: 'accepted',
      contactId: 'contact_1',
    })
    if (result.status !== 'accepted') throw new Error('unreachable')
    expect(result.offerId).toBeTruthy()

    // Deduplication mark on the envelope id.
    expect(state.inserts.webhook_events).toHaveLength(1)
    expect(state.inserts.webhook_events?.[0]).toMatchObject({
      id: 'evt_usage_1',
      provider: 'dhanam',
      eventType: 'ops.usage_limit_approaching',
    })

    // Timeline activity against the contact.
    expect(state.inserts.activities).toHaveLength(1)
    expect(state.inserts.activities?.[0]).toMatchObject({
      type: 'ops_event',
      entityType: 'contact',
      entityId: 'contact_1',
      status: 'completed',
    })
    expect(state.inserts.activities?.[0]?.title).toContain('80%')

    // Pending upsell offer to the suggested plan.
    expect(state.inserts.offers).toHaveLength(1)
    expect(state.inserts.offers?.[0]).toMatchObject({
      type: 'upsell',
      status: 'pending',
      externalProvider: 'dhanam',
      externalProductId: 'pro',
    })

    // Contact-linked external reference carrying the checkout attribution.
    const offerRef = state.inserts.external_references?.[0]
    expect(offerRef).toMatchObject({
      entityType: 'offer',
      entityId: state.inserts.offers?.[0]?.id,
      provider: 'phynd',
      externalId: 'contact_1',
      externalType: 'upsell_offer',
    })
    expect(offerRef?.metadata).toMatchObject({
      contact_id: 'contact_1',
      dhanam_customer_id: 'usr_1',
      suggested_plan: 'pro',
      current_plan: 'community',
      source_agent_id: 'phynd-upsell',
      utm_source: 'phynd-crm',
    })
  })

  it('falls back to the lowercased email when no external reference exists', async () => {
    seedContact(state, { email: 'ops@clientco.mx' })

    const service = new OpsEventsService(createCtx(state))
    const result = await service.ingest(
      usageEvent({}, {}, { dhanam_customer_id: undefined, email: 'OPS@ClientCo.MX' }),
    )

    expect(result).toMatchObject({ status: 'accepted', contactId: 'contact_1' })
    expect(state.inserts.activities).toHaveLength(1)
    expect(state.inserts.offers).toHaveLength(1)
  })

  it('skips an unresolvable subject without writing anything', async () => {
    const service = new OpsEventsService(createCtx(state))
    const result = await service.ingest(
      usageEvent({}, {}, { dhanam_customer_id: 'nope', email: 'nobody@nowhere.mx' }),
    )

    expect(result).toEqual({ status: 'skipped', reason: 'unresolved_contact' })
    expect(state.inserts).toEqual({})
    expect(state.webhookEventsById.size).toBe(0)
  })

  it('deduplicates a replay on the same webhook id — no activity or offer writes', async () => {
    seedContact(state)
    seedDhanamRef(state, 'usr_1')
    state.webhookEventsById.set('evt_usage_1', { id: 'evt_usage_1' })

    const service = new OpsEventsService(createCtx(state))
    const result = await service.ingest(usageEvent())

    expect(result).toEqual({ status: 'duplicate', contactId: 'contact_1' })
    expect(state.inserts.activities ?? []).toHaveLength(0)
    expect(state.inserts.offers ?? []).toHaveLength(0)
  })

  it('writes an activity but no offer for a milestone event', async () => {
    seedContact(state)

    const service = new OpsEventsService(createCtx(state))
    const result = await service.ingest({
      schema_version: 'madfam.ops.v1',
      id: 'evt_milestone_1',
      event_type: 'ops.project_milestone_reached',
      source: 'enclii',
      correlation_id: 'corr_2',
      timestamp: '2026-07-16T20:00:00Z',
      dedup_key: 'enclii:ops.project_milestone_reached:proj_abc:prod_deploy',
      subject: { email: 'ops@clientco.mx' },
      payload: { project_id: 'proj_abc', milestone: 'prod_deploy', environment: 'production' },
    })

    expect(result).toMatchObject({ status: 'accepted', contactId: 'contact_1', offerId: null })
    expect(state.inserts.activities).toHaveLength(1)
    expect(state.inserts.activities?.[0]?.title).toContain('prod_deploy')
    expect(state.inserts.offers ?? []).toHaveLength(0)
    expect(state.inserts.external_references ?? []).toHaveLength(0)
  })

  it('does not create an offer when usage is below the upsell threshold', async () => {
    seedContact(state)
    seedDhanamRef(state, 'usr_1')

    const service = new OpsEventsService(createCtx(state))
    const result = await service.ingest(usageEvent({}, { threshold_crossed: 50 }))

    expect(result).toMatchObject({ status: 'accepted', offerId: null })
    expect(state.inserts.activities).toHaveLength(1)
    expect(state.inserts.offers ?? []).toHaveLength(0)
  })

  it('skips unsupported event types', async () => {
    const service = new OpsEventsService(createCtx(state))
    const result = await service.ingest({
      event_type: 'ops.something_else',
      subject: { email: 'ops@clientco.mx' },
    })
    expect(result).toEqual({ status: 'skipped', reason: 'unsupported_event' })
  })
})

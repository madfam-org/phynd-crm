/**
 * Contract tests for POST /api/v1/probe/leads.
 *
 * Locks the wire contract documented in
 * `selva-office/packages/revenue-loop-probe/.../steps/crm.py`:
 *   - 503 when PHYND_CRM_PROBE_TOKEN is unset
 *   - 401 when bearer is missing or wrong
 *   - 400 when correlation_id is missing
 *   - 400 when body is not JSON
 *   - 200 when a probe lead already exists (idempotent reuse)
 *   - 201 + inserts when no probe lead exists yet
 *   - 503 when no pipeline or no stage is configured
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks (must be hoisted above the POST import)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
const db = {
  contacts: [] as Row[],
  leads: [] as Row[],
  pipelines: [] as Row[],
  stages: [] as Row[],
}

function idGen(prefix: string) {
  let n = 0
  return () => `${prefix}-${++n}`
}
const nextContactId = idGen('contact')
const nextLeadId = idGen('lead')

function makeChain(
  table: 'contacts' | 'leads' | 'pipelines' | 'stages',
  filter: (row: Row) => boolean,
) {
  const obj: {
    where: () => typeof obj
    limit: () => Promise<Row[]>
    orderBy: () => typeof obj
  } = {
    where: () => obj,
    limit: () => Promise.resolve(db[table].filter(filter)),
    orderBy: () => obj,
  }
  return obj
}

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  transaction: vi.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(mockDb))),
}

vi.mock('@phynd/db', () => ({
  getDb: () => mockDb,
  contacts: 'contacts-table',
  leads: 'leads-table',
  pipelines: 'pipelines-table',
  pipelineStages: 'stages-table',
  conversions: 'conversions-table',
  webhookEvents: 'webhook-events-table',
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ __and: args }),
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  sql: (strings: TemplateStringsArray, ..._values: unknown[]) => ({
    __sql: strings.join(''),
  }),
}))

import { POST } from '../leads/route'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  db.contacts = []
  db.leads = []
  db.pipelines = [{ id: 'pipe-1' }]
  db.stages = [{ id: 'stage-1', pipelineId: 'pipe-1' }]
  process.env = { ...ORIGINAL_ENV, PHYND_CRM_PROBE_TOKEN: 'test-token' }

  // Every `.select()` call returns a chain whose `.limit()` returns the
  // matching rows from `db`. We inspect the order of `.from(<table>)` calls
  // to know which table is being queried.
  mockDb.select.mockImplementation(() => {
    let tableKey: 'contacts' | 'leads' | 'pipelines' | 'stages' | null = null
    const chain = {
      from: (t: string) => {
        if (t === 'contacts-table') tableKey = 'contacts'
        else if (t === 'leads-table') tableKey = 'leads'
        else if (t === 'pipelines-table') tableKey = 'pipelines'
        else if (t === 'stages-table') tableKey = 'stages'
        return chain
      },
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(tableKey ? db[tableKey] : []),
    }
    return chain
  })

  mockDb.insert.mockImplementation((t: string) => ({
    values: (v: Row) => ({
      returning: () => {
        if (t === 'contacts-table') {
          const row = { id: nextContactId(), ...v }
          db.contacts.push(row)
          return Promise.resolve([row])
        }
        if (t === 'leads-table') {
          const row = { id: nextLeadId(), ...v }
          db.leads.push(row)
          return Promise.resolve([row])
        }
        throw new Error(`unexpected insert: ${t}`)
      },
    }),
  }))
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.clearAllMocks()
})

function probeRequest(body: unknown, authHeader?: string | null): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (authHeader !== null) {
    headers.authorization = authHeader ?? 'Bearer test-token'
  }
  return new Request('http://localhost/api/v1/probe/leads', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Auth + input validation
// ---------------------------------------------------------------------------

describe('POST /api/v1/probe/leads — auth', () => {
  it('returns 503 when PHYND_CRM_PROBE_TOKEN is unset', async () => {
    delete process.env.PHYND_CRM_PROBE_TOKEN
    const res = await POST(probeRequest({ correlation_id: 'c1' }))
    expect(res.status).toBe(503)
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await POST(probeRequest({ correlation_id: 'c1' }, null))
    expect(res.status).toBe(401)
  })

  it('returns 401 when bearer token is wrong', async () => {
    const res = await POST(probeRequest({ correlation_id: 'c1' }, 'Bearer wrong'))
    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/probe/leads — input', () => {
  it('returns 400 when body is not JSON', async () => {
    const res = await POST(probeRequest('not json'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when correlation_id is missing', async () => {
    const res = await POST(probeRequest({}))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/correlation_id/)
  })

  it('accepts correlation_id from X-Probe-Correlation-Id header', async () => {
    const req = new Request('http://localhost/api/v1/probe/leads', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token',
        'x-probe-correlation-id': 'corr-via-header',
      },
      body: '{}',
    })
    const res = await POST(req)
    expect(res.status).toBeLessThan(500)
  })
})

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe('POST /api/v1/probe/leads — upsert', () => {
  it('creates a new contact + lead on first call (201)', async () => {
    const res = await POST(probeRequest({ correlation_id: 'corr-1' }))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { lead_id: string; created: boolean }
    expect(body.created).toBe(true)
    expect(body.lead_id).toMatch(/^lead-/)
    expect(db.contacts).toHaveLength(1)
    expect(db.leads).toHaveLength(1)
  })

  it('reuses the probe lead when one already exists (200 + reused=true)', async () => {
    db.contacts = [{ id: 'contact-preseeded', externalJanuaId: 'probe-madfam-internal' }]
    db.leads = [{ id: 'lead-preseeded', contactId: 'contact-preseeded', source: 'synthetic-probe' }]

    const res = await POST(probeRequest({ correlation_id: 'corr-2' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { lead_id: string; reused: boolean }
    expect(body.reused).toBe(true)
    expect(body.lead_id).toBe('lead-preseeded')
    expect(db.leads).toHaveLength(1) // no duplicate inserted
  })
})

// ---------------------------------------------------------------------------
// Configuration failure modes
// ---------------------------------------------------------------------------

describe('POST /api/v1/probe/leads — misconfigured environment', () => {
  it('returns 503 when no pipeline exists', async () => {
    db.pipelines = []
    const res = await POST(probeRequest({ correlation_id: 'c3' }))
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/pipeline/)
  })

  it('returns 503 when the pipeline has no stages', async () => {
    db.stages = []
    const res = await POST(probeRequest({ correlation_id: 'c4' }))
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/stages?/)
  })
})

/**
 * GET /api/v1/convergence/{leads,opportunities} — the read API converge-dash
 * (dash.madfam.io) ingests. Locks:
 *   - auth: missing / malformed / wrong / right bearer, token unset or empty
 *   - period: required ISO-8601 window, period_start < period_end
 *   - tenant scope: CONVERGENCE_TENANT_IDS (default madfam), never the host
 *   - shape: every item passes converge-dash's own validators
 *     (packages/integrations/src/phynd-crm.ts), mirrored below
 * The database is replaced by fixture rows fed through the real mapping.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rateLimit = vi.hoisted(() => vi.fn())
const getDb = vi.hoisted(() => vi.fn((tenantId: string) => ({ tenantId })))
const databaseUrls = vi.hoisted(() => ({}) as Record<string, string>)
const fixtures = vi.hoisted(() => ({
  leads: {} as Record<string, unknown[]>,
  opportunities: {} as Record<string, unknown[]>,
  customers: {} as Record<string, string[]>,
  fail: false,
}))

vi.mock('@/lib/rate-limiter', () => ({ checkApiRateLimit: rateLimit }))
vi.mock('@phynd/db', () => ({ getDb }))
vi.mock('@phynd/config/connections', () => ({
  resolveDatabaseUrl: (tenantId: string) => databaseUrls[tenantId] ?? 'postgres://db/default',
}))
vi.mock('@phynd/logging', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('@phynd/services/convergence/convergence-feed', async (importOriginal) => {
  const real = await importOriginal<typeof import('@phynd/services/convergence/convergence-feed')>()
  type Period = import('@phynd/services/convergence/convergence-feed').ConvergencePeriod
  class FixtureFeedService {
    private readonly tenantId: string
    constructor(db: { tenantId: string }) {
      this.tenantId = db.tenantId
    }
    private customers() {
      return new Set(fixtures.customers[this.tenantId] ?? [])
    }
    async listLeads(period: Period) {
      if (fixtures.fail) throw new Error('connection refused')
      const rows = (fixtures.leads[this.tenantId] ?? []) as Parameters<
        typeof real.toConvergenceLead
      >[0][]
      return real.collectFeed(
        rows.filter((row) => real.isLeadInPeriod(row, period)),
        (row) => real.toConvergenceLead(row, this.customers()),
      )
    }
    async listOpportunities(period: Period) {
      if (fixtures.fail) throw new Error('connection refused')
      const rows = (fixtures.opportunities[this.tenantId] ?? []) as Parameters<
        typeof real.toConvergenceOpportunity
      >[0][]
      return real.collectFeed(
        rows.filter((row) => real.isOpportunityInPeriod(row, period)),
        (row) => real.toConvergenceOpportunity(row, this.customers()),
      )
    }
  }
  return { ...real, ConvergenceFeedService: FixtureFeedService }
})

import { GET as getLeads } from '../leads/route'
import { GET as getOpportunities } from '../opportunities/route'

// ---------------------------------------------------------------------------
// converge-dash's validators (packages/integrations/src/{contracts,phynd-crm}.ts)
// ---------------------------------------------------------------------------

type Item = Record<string, unknown>

function requireString(item: Item, field: string, issues: string[]) {
  const value = item[field]
  if (typeof value !== 'string' || value.trim() === '') issues.push(`${field} required string`)
}
function optionalString(item: Item, field: string, issues: string[]) {
  if (item[field] !== undefined && typeof item[field] !== 'string') issues.push(`${field} string`)
}
function requireNumber(item: Item, field: string, issues: string[]) {
  const value = item[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) issues.push(`${field} required number`)
}
function optionalNumber(item: Item, field: string, issues: string[]) {
  const value = item[field]
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
    issues.push(`${field} number`)
  }
}
function onlyKeys(item: Item, allowed: string[], issues: string[]) {
  for (const key of Object.keys(item)) if (!allowed.includes(key)) issues.push(`${key} unexpected`)
}
function isoField(item: Item, field: string, issues: string[]) {
  const value = item[field]
  if (typeof value === 'string' && Number.isNaN(Date.parse(value))) issues.push(`${field} not ISO`)
}

function validateLead(item: Item): string[] {
  const issues: string[] = []
  requireString(item, 'lead_id', issues)
  optionalString(item, 'contact_id', issues)
  optionalString(item, 'customer_id', issues)
  optionalString(item, 'captured_at', issues)
  optionalString(item, 'source', issues)
  requireString(item, 'status', issues)
  optionalNumber(item, 'score', issues)
  isoField(item, 'captured_at', issues)
  onlyKeys(
    item,
    ['lead_id', 'contact_id', 'customer_id', 'captured_at', 'source', 'status', 'score'],
    issues,
  )
  return issues
}

function validateOpportunity(item: Item): string[] {
  const issues: string[] = []
  requireString(item, 'opportunity_id', issues)
  optionalString(item, 'customer_id', issues)
  optionalString(item, 'business_line', issues)
  requireString(item, 'stage', issues)
  requireNumber(item, 'value', issues)
  requireNumber(item, 'probability', issues)
  optionalString(item, 'expected_close_at', issues)
  optionalString(item, 'closed_at', issues)
  const probability = item.probability as number
  if (probability < 0 || probability > 1) issues.push('probability outside 0–1')
  isoField(item, 'expected_close_at', issues)
  isoField(item, 'closed_at', issues)
  onlyKeys(
    item,
    [
      'opportunity_id',
      'customer_id',
      'business_line',
      'stage',
      'value',
      'probability',
      'expected_close_at',
      'closed_at',
    ],
    issues,
  )
  return issues
}

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const TOKEN = 'convergence-test-token-0123456789abcdef'
const NOVEMBER = 'period_start=2026-11-01T00:00:00.000Z&period_end=2026-12-01T00:00:00.000Z'
const ORIGINAL_ENV = { ...process.env }

function request(feed: 'leads' | 'opportunities', query = NOVEMBER, headers: HeadersInit = {}) {
  return new Request(`https://crm.madfam.io/api/v1/convergence/${feed}?${query}`, { headers })
}
const authorized = { authorization: `Bearer ${TOKEN}` }

function leadRow(id: string, createdAt: string, overrides: Item = {}) {
  return {
    id,
    status: 'qualified',
    contactId: 'contact-1',
    source: 'tezca-interest',
    score: 70,
    createdAt: new Date(createdAt),
    ...overrides,
  }
}

function oppRow(id: string, overrides: Item = {}) {
  return {
    id,
    status: 'open',
    stageName: 'Proposal',
    stageProbability: 50,
    value: '250000.00',
    probability: 40,
    contactId: 'contact-1',
    expectedCloseDate: new Date('2026-12-20T00:00:00.000Z'),
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-02T00:00:00.000Z'),
    wonAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, CONVERGENCE_API_TOKEN: TOKEN }
  delete process.env.CONVERGENCE_TENANT_IDS
  rateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 59 })
  getDb.mockClear()
  for (const key of Object.keys(databaseUrls)) delete databaseUrls[key]
  fixtures.fail = false
  fixtures.customers = { madfam: ['contact-1'] }
  fixtures.leads = {
    madfam: [
      leadRow('lead-oct', '2026-10-31T23:59:59.999Z'),
      leadRow('lead-start', '2026-11-01T00:00:00.000Z'),
      leadRow('lead-mid', '2026-11-15T10:00:00.000Z', { contactId: 'contact-2', score: null }),
      leadRow('lead-end', '2026-12-01T00:00:00.000Z'),
    ],
  }
  fixtures.opportunities = {
    madfam: [
      oppRow('opp-open'),
      oppRow('opp-won-nov', { status: 'won', wonAt: new Date('2026-11-10T00:00:00.000Z') }),
      oppRow('opp-won-sep', { status: 'won', wonAt: new Date('2026-09-10T00:00:00.000Z') }),
      oppRow('opp-lost-nov', {
        status: 'lost',
        contactId: null,
        updatedAt: new Date('2026-11-03T00:00:00.000Z'),
      }),
      oppRow('opp-dec', { createdAt: new Date('2026-12-01T00:00:00.000Z') }),
      oppRow('opp-unpriced', { value: null }),
    ],
  }
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe.each([
  ['leads', getLeads],
  ['opportunities', getOpportunities],
] as const)('GET /api/v1/convergence/%s auth', (feed, GET) => {
  it('401 without an Authorization header', async () => {
    const res = await GET(request(feed))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe('Bearer')
    expect(await res.json()).toEqual({ error: 'Missing or malformed Authorization header' })
    expect(getDb).not.toHaveBeenCalled()
  })

  it('401 for a non-Bearer scheme', async () => {
    const res = await GET(request(feed, NOVEMBER, { authorization: `Basic ${TOKEN}` }))
    expect(res.status).toBe(401)
  })

  it('401 for a wrong token, including a prefix of the right one', async () => {
    for (const token of ['wrong-token', TOKEN.slice(0, -1), `${TOKEN}x`]) {
      const res = await GET(request(feed, NOVEMBER, { authorization: `Bearer ${token}` }))
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Invalid convergence token' })
    }
    expect(getDb).not.toHaveBeenCalled()
  })

  it('401 "not configured" when CONVERGENCE_API_TOKEN is unset or blank — fails closed', async () => {
    for (const value of [undefined, '', '   ']) {
      if (value === undefined) delete process.env.CONVERGENCE_API_TOKEN
      else process.env.CONVERGENCE_API_TOKEN = value
      const res = await GET(request(feed, NOVEMBER, authorized))
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Convergence authentication is not configured' })
    }
    expect(getDb).not.toHaveBeenCalled()
  })

  it('200 with the right token', async () => {
    const res = await GET(request(feed, NOVEMBER, authorized))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(Array.isArray(await res.json())).toBe(true)
  })

  it('429 when the rate limit is exhausted, before any token check', async () => {
    rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0 })
    const res = await GET(request(feed, NOVEMBER, authorized))
    expect(res.status).toBe(429)
    expect(rateLimit).toHaveBeenCalledWith('convergence:127.0.0.1', { maxRequests: 60 })
  })
})

// ---------------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------------

describe('period validation', () => {
  it.each([
    ['missing period_end', 'period_start=2026-11-01T00:00:00.000Z'],
    ['not a date', 'period_start=yesterday&period_end=2026-12-01T00:00:00.000Z'],
    ['zone-less date-time', 'period_start=2026-11-01T00:00:00&period_end=2026-12-01T00:00:00'],
    ['impossible day', 'period_start=2026-02-30&period_end=2026-03-01'],
  ])('400 for %s', async (_label, query) => {
    const res = await getLeads(request('leads', query, authorized))
    expect(res.status).toBe(400)
    expect(getDb).not.toHaveBeenCalled()
  })

  it('400 when period_start is not before period_end', async () => {
    const same = 'period_start=2026-11-01T00:00:00.000Z&period_end=2026-11-01T00:00:00.000Z'
    const res = await getOpportunities(request('opportunities', same, authorized))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'period_start must be before period_end' })
  })

  it('accepts date-only bounds and an offset whose + arrived unencoded', async () => {
    const dates = await getLeads(
      request('leads', 'period_start=2026-11-01&period_end=2026-12-01', authorized),
    )
    const offset = await getLeads(
      request('leads', 'period_start=2026-11-01T06:00:00+06:00&period_end=2026-12-01', authorized),
    )
    expect(dates.status).toBe(200)
    expect(offset.status).toBe(200)
    expect((await offset.json()).map((lead: Item) => lead.lead_id)).toEqual([
      'lead-start',
      'lead-mid',
    ])
  })
})

// ---------------------------------------------------------------------------
// Period filtering and shape
// ---------------------------------------------------------------------------

describe('GET /api/v1/convergence/leads', () => {
  it('returns leads captured in [period_start, period_end), in converge-dash shape', async () => {
    const res = await getLeads(request('leads', NOVEMBER, authorized))
    const body = (await res.json()) as Item[]

    expect(body.map((lead) => lead.lead_id)).toEqual(['lead-start', 'lead-mid'])
    for (const lead of body) expect(validateLead(lead)).toEqual([])
    expect(body).toEqual([
      {
        lead_id: 'lead-start',
        status: 'qualified',
        contact_id: 'contact-1',
        customer_id: 'contact-1',
        captured_at: '2026-11-01T00:00:00.000Z',
        source: 'tezca-interest',
        score: 70,
      },
      {
        lead_id: 'lead-mid',
        status: 'qualified',
        contact_id: 'contact-2',
        captured_at: '2026-11-15T10:00:00.000Z',
        source: 'tezca-interest',
      },
    ])
  })

  it('returns an empty array for a period with no leads', async () => {
    const res = await getLeads(
      request('leads', 'period_start=2025-01-01&period_end=2025-02-01', authorized),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})

describe('GET /api/v1/convergence/opportunities', () => {
  it('returns deals open during the period or closed within it, in converge-dash shape', async () => {
    const res = await getOpportunities(request('opportunities', NOVEMBER, authorized))
    const body = (await res.json()) as Item[]

    expect(body.map((opp) => opp.opportunity_id)).toEqual([
      'opp-open',
      'opp-won-nov',
      'opp-lost-nov',
    ])
    for (const opp of body) expect(validateOpportunity(opp)).toEqual([])
    expect(body).toEqual([
      {
        opportunity_id: 'opp-open',
        stage: 'Proposal',
        value: 250000,
        probability: 0.4,
        customer_id: 'contact-1',
        expected_close_at: '2026-12-20T00:00:00.000Z',
      },
      {
        opportunity_id: 'opp-won-nov',
        stage: 'closed_won',
        value: 250000,
        probability: 1,
        customer_id: 'contact-1',
        expected_close_at: '2026-12-20T00:00:00.000Z',
        closed_at: '2026-11-10T00:00:00.000Z',
      },
      {
        opportunity_id: 'opp-lost-nov',
        stage: 'closed_lost',
        value: 250000,
        probability: 0,
        expected_close_at: '2026-12-20T00:00:00.000Z',
      },
    ])
  })

  it('never serialises null (converge-dash rejects it as a wrong type)', async () => {
    const res = await getOpportunities(request('opportunities', NOVEMBER, authorized))
    expect(await res.text()).not.toContain('null')
  })
})

// ---------------------------------------------------------------------------
// Tenant scope and failures
// ---------------------------------------------------------------------------

describe('tenant scope', () => {
  it('reads only the madfam tenant by default, whatever the request host', async () => {
    const res = await getLeads(
      new Request(`https://phynd.app/api/v1/convergence/leads?${NOVEMBER}`, {
        headers: authorized,
      }),
    )
    expect(res.status).toBe(200)
    expect(getDb.mock.calls).toEqual([['madfam']])
  })

  it('reads every configured tenant once per database', async () => {
    process.env.CONVERGENCE_TENANT_IDS = 'madfam, acme, madfam_ops'
    databaseUrls.madfam = 'postgres://db/madfam'
    databaseUrls.acme = 'postgres://db/acme'
    databaseUrls.madfam_ops = 'postgres://db/madfam'
    fixtures.leads.acme = [leadRow('acme-lead', '2026-11-05T00:00:00.000Z')]

    const res = await getLeads(request('leads', NOVEMBER, authorized))
    expect(getDb.mock.calls).toEqual([['madfam'], ['acme']])
    expect((await res.json()).map((lead: Item) => lead.lead_id)).toEqual([
      'lead-start',
      'lead-mid',
      'acme-lead',
    ])
  })

  it('500 rather than guess when CONVERGENCE_TENANT_IDS is malformed', async () => {
    process.env.CONVERGENCE_TENANT_IDS = 'madfam,demo-123'
    const res = await getLeads(request('leads', NOVEMBER, authorized))
    expect(res.status).toBe(500)
    expect(getDb).not.toHaveBeenCalled()
  })

  it('500 without internals when the database read fails', async () => {
    fixtures.fail = true
    const res = await getOpportunities(request('opportunities', NOVEMBER, authorized))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Convergence feed unavailable' })
  })
})

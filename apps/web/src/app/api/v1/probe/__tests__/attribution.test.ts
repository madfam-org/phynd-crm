/**
 * Contract tests for GET /api/v1/probe/attribution.
 *
 * Locks the wire contract documented in
 * `selva-office/packages/revenue-loop-probe/.../steps/phynd_attribution.py`:
 *   - 503 when PHYND_CRM_PROBE_TOKEN is unset
 *   - 401 when bearer is missing or wrong
 *   - 400 when lead_id or billing_id query params missing
 *   - 200 `{ credited: false, ... }` when no matching conversion
 *   - 200 `{ credited: true, ... }` when a conversion matches by
 *     metadata.event_id OR metadata.webhook_event_id OR metadata.billing_id,
 *     for the lead in `lead_id` (the converting event) or in
 *     `metadata.contact_lead_id` (every later event, e.g. a renewal)
 *
 * The db mock evaluates the route's where clause against the rows, so a row
 * of another lead or another billing id is not returned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = {
  conversions: [] as Array<Record<string, unknown>>,
}

type Cond = { _tag: string; args?: Cond[]; col?: unknown; val?: unknown; raw?: string }
type ConversionRow = Record<string, unknown> & { metadata?: Record<string, unknown> }

/** Evaluates the mocked where tree (and / or / eq / sql) against one row. */
function holds(cond: Cond, row: ConversionRow): boolean {
  const meta = row.metadata ?? {}
  switch (cond._tag) {
    case 'and':
      return (cond.args ?? []).every((inner) => holds(inner, row))
    case 'or':
      return (cond.args ?? []).some((inner) => holds(inner, row))
    case 'eq':
      return cond.col === 'conversions.leadId' && row.leadId === cond.val
    case 'sql':
      if (cond.raw?.includes("'contact_lead_id'")) return meta.contact_lead_id === cond.val
      return [meta.event_id, meta.webhook_event_id, meta.billing_id].includes(cond.val)
    default:
      throw new Error(`unsupported condition ${cond._tag}`)
  }
}

const mockDb = {
  select: vi.fn(() => ({
    from: () => ({
      where: (cond: Cond) => ({
        orderBy: () => ({
          limit: (n: number) =>
            Promise.resolve(
              db.conversions
                .filter((row) => holds(cond, row))
                .sort(
                  (a, b) =>
                    new Date(String(b.recordedAt)).getTime() -
                    new Date(String(a.recordedAt)).getTime(),
                )
                .slice(0, n),
            ),
        }),
      }),
    }),
  })),
}

vi.mock('@phynd/db', () => ({
  getDb: () => mockDb,
  conversions: { leadId: 'conversions.leadId', metadata: 'conversions.metadata' },
  contacts: 'contacts-table',
  leads: 'leads-table',
  pipelines: 'pipelines-table',
  pipelineStages: 'stages-table',
  webhookEvents: 'webhook-events-table',
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ _tag: 'and', args }),
  or: (...args: unknown[]) => ({ _tag: 'or', args }),
  eq: (col: unknown, val: unknown) => ({ _tag: 'eq', col, val }),
  // The bound parameter is the last interpolated value.
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    _tag: 'sql',
    raw: strings.join(''),
    val: values.at(-1),
  }),
}))

import { GET } from '../attribution/route'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  db.conversions = []
  process.env = { ...ORIGINAL_ENV, PHYND_CRM_PROBE_TOKEN: 'probe-tok' }
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.clearAllMocks()
})

function probeRequest(
  query: Record<string, string>,
  authHeader: string | null = 'Bearer probe-tok',
): Request {
  const qs = new URLSearchParams(query).toString()
  const headers: Record<string, string> = {}
  if (authHeader !== null) headers.authorization = authHeader
  return new Request(`http://localhost/api/v1/probe/attribution?${qs}`, { headers })
}

describe('GET /api/v1/probe/attribution — auth + input', () => {
  it('returns 503 when PHYND_CRM_PROBE_TOKEN is unset', async () => {
    delete process.env.PHYND_CRM_PROBE_TOKEN
    const res = await GET(probeRequest({ lead_id: 'l1', billing_id: 'b1' }))
    expect(res.status).toBe(503)
  })

  it('returns 401 when bearer is missing', async () => {
    const res = await GET(probeRequest({ lead_id: 'l1', billing_id: 'b1' }, null))
    expect(res.status).toBe(401)
  })

  it('returns 401 when bearer is wrong', async () => {
    const res = await GET(probeRequest({ lead_id: 'l1', billing_id: 'b1' }, 'Bearer wrong'))
    expect(res.status).toBe(401)
  })

  it('returns 400 when lead_id is missing', async () => {
    const res = await GET(probeRequest({ billing_id: 'b1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when billing_id is missing', async () => {
    const res = await GET(probeRequest({ lead_id: 'l1' }))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/probe/attribution — lookups', () => {
  it('returns credited:false (200) when no conversion matches', async () => {
    db.conversions = []
    const res = await GET(probeRequest({ lead_id: 'l1', billing_id: 'b1' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { credited: boolean; reason: string }
    expect(body.credited).toBe(false)
    expect(body.reason).toMatch(/no matching conversion/i)
  })

  it('returns credited:true with metadata fields when a conversion matches', async () => {
    db.conversions = [
      {
        id: 'conv-1',
        leadId: 'l1',
        value: '1500.00',
        metadata: {
          event_id: 'b1',
          source_agent_id: 'agent-heraldo',
          campaign_id: 'camp-q3',
          amount_minor: 150_000,
        },
        createdAt: new Date('2026-04-17T12:00:00.000Z'),
      },
    ]
    const res = await GET(probeRequest({ lead_id: 'l1', billing_id: 'b1' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      credited: boolean
      attribution_id: string
      source_agent: string
      campaign_id: string
      credit_amount_mxn_cents: number
    }
    expect(body.credited).toBe(true)
    expect(body.attribution_id).toBe('conv-1')
    expect(body.source_agent).toBe('agent-heraldo')
    expect(body.campaign_id).toBe('camp-q3')
    expect(body.credit_amount_mxn_cents).toBe(150_000)
  })

  it('derives amount_minor from the decimal `value` column when metadata lacks amount_minor', async () => {
    db.conversions = [
      {
        id: 'conv-2',
        leadId: 'l2',
        value: '42.50',
        metadata: { event_id: 'b2' },
        createdAt: new Date(),
      },
    ]
    const res = await GET(probeRequest({ lead_id: 'l2', billing_id: 'b2' }))
    const body = (await res.json()) as { credit_amount_mxn_cents: number }
    // 42.50 * 100 = 4250 (rounded)
    expect(body.credit_amount_mxn_cents).toBe(4250)
  })
})

describe('GET /api/v1/probe/attribution — renewals', () => {
  // A contact's lead converted on the first payment; the renewal row carries
  // no lead id, only metadata.contact_lead_id (as the Dhanam webhook writes it).
  const firstPayment = {
    id: 'conv-first',
    leadId: 'lead-r',
    value: '199.00',
    metadata: { event_id: 'evt-first', contact_lead_id: 'lead-r', amount_minor: 19_900 },
    recordedAt: new Date('2026-10-01T12:00:00.000Z'),
  }
  const renewal = {
    id: 'conv-renewal',
    leadId: null,
    value: '199.00',
    metadata: { event_id: 'evt-renewal', contact_lead_id: 'lead-r', amount_minor: 19_900 },
    recordedAt: new Date('2026-11-01T12:00:00.000Z'),
  }

  beforeEach(() => {
    db.conversions = [firstPayment, renewal]
  })

  it("credits a renewal's billing id through metadata.contact_lead_id", async () => {
    const res = await GET(probeRequest({ lead_id: 'lead-r', billing_id: 'evt-renewal' }))
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      credited: true,
      attribution_id: 'conv-renewal',
      credit_amount_mxn_cents: 19_900,
    })
  })

  it('still credits the converting event, once, with its own amount', async () => {
    const res = await GET(probeRequest({ lead_id: 'lead-r', billing_id: 'evt-first' }))
    const body = (await res.json()) as Record<string, unknown>
    // The row matches by lead_id and by contact_lead_id: still one row, one amount.
    expect(body).toMatchObject({
      credited: true,
      attribution_id: 'conv-first',
      credit_amount_mxn_cents: 19_900,
    })
  })

  it('does not credit a billing id to another lead', async () => {
    const res = await GET(probeRequest({ lead_id: 'lead-other', billing_id: 'evt-renewal' }))
    const body = (await res.json()) as Record<string, unknown>
    expect(body.credited).toBe(false)
  })
})

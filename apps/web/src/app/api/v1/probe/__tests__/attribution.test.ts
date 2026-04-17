/**
 * Contract tests for GET /api/v1/probe/attribution.
 *
 * Locks the wire contract documented in
 * `autoswarm-office/packages/revenue-loop-probe/.../steps/phyne_attribution.py`:
 *   - 503 when PHYNE_CRM_PROBE_TOKEN is unset
 *   - 401 when bearer is missing or wrong
 *   - 400 when lead_id or billing_id query params missing
 *   - 200 `{ credited: false, ... }` when no matching conversion
 *   - 200 `{ credited: true, ... }` when a conversion matches by
 *     metadata.event_id OR metadata.webhook_event_id OR metadata.billing_id
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = {
  conversions: [] as Array<Record<string, unknown>>,
}

const mockDb = {
  select: vi.fn(() => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: () => Promise.resolve(db.conversions),
        }),
      }),
    }),
  })),
}

vi.mock('@phyne/db', () => ({
  getDb: () => mockDb,
  conversions: 'conversions-table',
  contacts: 'contacts-table',
  leads: 'leads-table',
  pipelines: 'pipelines-table',
  pipelineStages: 'stages-table',
  webhookEvents: 'webhook-events-table',
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ __and: args }),
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  sql: (strings: TemplateStringsArray, ..._values: unknown[]) => ({
    __sql: strings.join(''),
  }),
}))

import { GET } from '../attribution/route'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  db.conversions = []
  process.env = { ...ORIGINAL_ENV, PHYNE_CRM_PROBE_TOKEN: 'probe-tok' }
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
  it('returns 503 when PHYNE_CRM_PROBE_TOKEN is unset', async () => {
    delete process.env.PHYNE_CRM_PROBE_TOKEN
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

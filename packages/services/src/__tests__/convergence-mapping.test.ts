/**
 * Period rule and field mapping of the convergence read API
 * (docs/CONVERGENCE_API.md). Pure functions: no database involved.
 */
import { describe, expect, it } from 'vitest'
import {
  CLOSED_LOST_STAGE,
  CLOSED_WON_STAGE,
  type ConvergencePeriod,
  type LeadFeedRow,
  type OpportunityFeedRow,
  closeTimeBound,
  collectFeed,
  isLeadInPeriod,
  isOpportunityInPeriod,
  toConvergenceLead,
  toConvergenceOpportunity,
} from '../convergence/convergence-mapping'

const NOVEMBER: ConvergencePeriod = {
  start: new Date('2026-11-01T00:00:00.000Z'),
  end: new Date('2026-12-01T00:00:00.000Z'),
}
const at = (iso: string) => new Date(iso)

function lead(overrides: Partial<LeadFeedRow> = {}): LeadFeedRow {
  return {
    id: 'lead-1',
    status: 'new',
    contactId: 'contact-1',
    source: 'website',
    score: 42,
    createdAt: at('2026-11-10T12:00:00.000Z'),
    ...overrides,
  }
}

function opp(overrides: Partial<OpportunityFeedRow> = {}): OpportunityFeedRow {
  return {
    id: 'opp-1',
    status: 'open',
    stageName: 'Negotiation',
    stageProbability: 75,
    value: '150000.00',
    probability: 60,
    contactId: 'contact-1',
    expectedCloseDate: at('2026-12-15T00:00:00.000Z'),
    createdAt: at('2026-10-01T00:00:00.000Z'),
    updatedAt: at('2026-10-20T00:00:00.000Z'),
    wonAt: null,
    ...overrides,
  }
}

describe('isLeadInPeriod — selected by capture time, [start, end)', () => {
  it.each([
    ['captured at period_start (inclusive)', '2026-11-01T00:00:00.000Z', true],
    ['captured inside the period', '2026-11-15T08:30:00.000Z', true],
    ['captured 1 ms before period_end', '2026-11-30T23:59:59.999Z', true],
    ['captured at period_end (exclusive)', '2026-12-01T00:00:00.000Z', false],
    ['captured 1 ms before period_start', '2026-10-31T23:59:59.999Z', false],
  ])('%s → %s', (_label, createdAt, expected) => {
    expect(isLeadInPeriod(lead({ createdAt: at(createdAt) }), NOVEMBER)).toBe(expected)
  })
})

describe('isOpportunityInPeriod — open during the period or closed within it', () => {
  it('includes an open opportunity created before the period', () => {
    expect(isOpportunityInPeriod(opp(), NOVEMBER)).toBe(true)
  })

  it('includes an open opportunity created inside the period', () => {
    expect(
      isOpportunityInPeriod(opp({ createdAt: at('2026-11-20T00:00:00.000Z') }), NOVEMBER),
    ).toBe(true)
  })

  it('excludes an opportunity created at or after period_end', () => {
    expect(isOpportunityInPeriod(opp({ createdAt: NOVEMBER.end }), NOVEMBER)).toBe(false)
    expect(
      isOpportunityInPeriod(opp({ createdAt: at('2027-01-01T00:00:00.000Z') }), NOVEMBER),
    ).toBe(false)
  })

  it.each([
    ['won before the period', '2026-10-31T23:59:59.999Z', false],
    ['won exactly at period_start', '2026-11-01T00:00:00.000Z', true],
    ['won inside the period', '2026-11-18T00:00:00.000Z', true],
    ['won after the period (open during all of it)', '2026-12-05T00:00:00.000Z', true],
  ])('uses the recorded win time: %s → %s', (_label, wonAt, expected) => {
    const won = opp({ status: 'won', wonAt: at(wonAt), updatedAt: at('2026-12-31T00:00:00.000Z') })
    expect(isOpportunityInPeriod(won, NOVEMBER)).toBe(expected)
  })

  it('bounds a close with no recorded time by updated_at', () => {
    const lostBefore = opp({ status: 'lost', updatedAt: at('2026-10-15T00:00:00.000Z') })
    const lostInside = opp({ status: 'lost', updatedAt: at('2026-11-02T00:00:00.000Z') })
    const wonByImport = opp({
      status: 'won',
      wonAt: null,
      updatedAt: at('2026-11-03T00:00:00.000Z'),
    })
    expect(isOpportunityInPeriod(lostBefore, NOVEMBER)).toBe(false)
    expect(isOpportunityInPeriod(lostInside, NOVEMBER)).toBe(true)
    expect(isOpportunityInPeriod(wonByImport, NOVEMBER)).toBe(true)
  })

  it('ignores a stale win conversion once the opportunity is no longer won', () => {
    const reopened = opp({ status: 'open', wonAt: at('2026-09-01T00:00:00.000Z') })
    expect(closeTimeBound(reopened)).toBeNull()
    expect(isOpportunityInPeriod(reopened, NOVEMBER)).toBe(true)
  })
})

describe('toConvergenceLead', () => {
  it('maps every field it has', () => {
    expect(toConvergenceLead(lead(), new Set())).toEqual({
      item: {
        lead_id: 'lead-1',
        status: 'new',
        contact_id: 'contact-1',
        captured_at: '2026-11-10T12:00:00.000Z',
        source: 'website',
        score: 42,
      },
    })
  })

  it('sets customer_id only when the contact is a customer', () => {
    const result = toConvergenceLead(lead(), new Set(['contact-1']))
    expect(result).toMatchObject({ item: { contact_id: 'contact-1', customer_id: 'contact-1' } })
  })

  it('omits optional fields it lacks — never null', () => {
    const result = toConvergenceLead(
      lead({ contactId: null, source: '  ', score: null }),
      new Set(),
    )
    expect(result).toEqual({
      item: { lead_id: 'lead-1', status: 'new', captured_at: '2026-11-10T12:00:00.000Z' },
    })
  })

  it('leaves out a lead without a status', () => {
    expect(toConvergenceLead(lead({ status: ' ' }), new Set())).toEqual({
      omitted: 'missing_status',
    })
  })
})

describe('toConvergenceOpportunity', () => {
  it('maps an open opportunity: stage name, MXN value as a number, probability 0–1', () => {
    expect(toConvergenceOpportunity(opp(), new Set())).toEqual({
      item: {
        opportunity_id: 'opp-1',
        stage: 'Negotiation',
        value: 150000,
        probability: 0.6,
        expected_close_at: '2026-12-15T00:00:00.000Z',
      },
    })
  })

  it("falls back to the stage's default probability", () => {
    const result = toConvergenceOpportunity(opp({ probability: null }), new Set())
    expect(result).toMatchObject({ item: { probability: 0.75 } })
  })

  it('maps a won deal to closed_won, probability 1 and its recorded close time', () => {
    const won = opp({ status: 'won', probability: 80, wonAt: at('2026-11-18T16:00:00.000Z') })
    expect(toConvergenceOpportunity(won, new Set(['contact-1']))).toEqual({
      item: {
        opportunity_id: 'opp-1',
        stage: CLOSED_WON_STAGE,
        value: 150000,
        probability: 1,
        customer_id: 'contact-1',
        expected_close_at: '2026-12-15T00:00:00.000Z',
        closed_at: '2026-11-18T16:00:00.000Z',
      },
    })
  })

  it('maps a lost deal to closed_lost and probability 0, without inventing closed_at', () => {
    const lost = opp({ status: 'lost', expectedCloseDate: null })
    expect(toConvergenceOpportunity(lost, new Set())).toEqual({
      item: { opportunity_id: 'opp-1', stage: CLOSED_LOST_STAGE, value: 150000, probability: 0 },
    })
  })

  it('leaves out opportunities missing a required value instead of inventing one', () => {
    expect(toConvergenceOpportunity(opp({ value: null }), new Set())).toEqual({
      omitted: 'missing_value',
    })
    expect(
      toConvergenceOpportunity(opp({ probability: null, stageProbability: null }), new Set()),
    ).toEqual({ omitted: 'missing_probability' })
    expect(
      toConvergenceOpportunity(opp({ probability: 140, stageProbability: null }), new Set()),
    ).toEqual({ omitted: 'missing_probability' })
    expect(toConvergenceOpportunity(opp({ stageName: null }), new Set())).toEqual({
      omitted: 'missing_stage',
    })
  })

  it('keeps a recorded zero value', () => {
    expect(toConvergenceOpportunity(opp({ value: '0.00' }), new Set())).toMatchObject({
      item: { value: 0 },
    })
  })
})

describe('collectFeed', () => {
  it('keeps mapped items in order and counts omissions by reason', () => {
    const rows = [opp({ id: 'a' }), opp({ id: 'b', value: null }), opp({ id: 'c' })]
    const result = collectFeed(rows, (row) => toConvergenceOpportunity(row, new Set()))
    expect(result.items.map((item) => item.opportunity_id)).toEqual(['a', 'c'])
    expect(result.omitted).toEqual({ missing_value: 1 })
  })
})

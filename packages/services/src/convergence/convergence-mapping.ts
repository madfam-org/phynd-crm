/**
 * Pure mapping for the convergence read API (`GET /api/v1/convergence/*`),
 * which converge-dash (dash.madfam.io) ingests. The wire contract is
 * converge-dash `packages/integrations/src/phynd-crm.ts`; the rules are
 * documented in `docs/CONVERGENCE_API.md`.
 *
 * Everything here is free of I/O so the period rule and the field mapping are
 * unit-tested directly. The SQL in `convergence-feed.ts` only narrows
 * the candidate rows; these predicates decide what is returned.
 *
 * converge-dash rejects the WHOLE array when one item breaks the contract
 * (`validateArrayPayload`), and treats `null` as a type error. So optional
 * fields are omitted (never null), and an item missing a required value is
 * left out of the feed instead of being sent with an invented value.
 */

/** Half-open window `[start, end)`. */
export interface ConvergencePeriod {
  start: Date
  end: Date
}

export interface ConvergenceLead {
  lead_id: string
  status: string
  contact_id?: string
  customer_id?: string
  captured_at?: string
  source?: string
  score?: number
}

export interface ConvergenceOpportunity {
  opportunity_id: string
  stage: string
  /** MXN. Opportunities have no currency column; the CRM records them in MXN. */
  value: number
  /** 0–1. */
  probability: number
  customer_id?: string
  business_line?: string
  expected_close_at?: string
  closed_at?: string
}

export interface LeadFeedRow {
  id: string
  status: string
  contactId: string | null
  source: string | null
  score: number | null
  createdAt: Date
}

export interface OpportunityFeedRow {
  id: string
  status: string
  stageName: string | null
  /** `pipeline_stages.probability`, 0–100. */
  stageProbability: number | null
  /** `numeric(12,2)` as returned by the driver. */
  value: string | null
  /** `opportunities.probability`, 0–100. */
  probability: number | null
  contactId: string | null
  expectedCloseDate: Date | null
  createdAt: Date
  updatedAt: Date
  /** `converted_at` of the opportunity's `opportunity_to_won` conversion, if any. */
  wonAt: Date | null
}

/** Stage sent for a won / lost opportunity (converge-dash excludes `closed_lost` from pipeline). */
export const CLOSED_WON_STAGE = 'closed_won'
export const CLOSED_LOST_STAGE = 'closed_lost'

export type OmitReason =
  | 'missing_status'
  | 'missing_stage'
  | 'missing_value'
  | 'missing_probability'

export type MapResult<T> = { item: T } | { omitted: OmitReason }

export interface FeedResult<T> {
  items: T[]
  omitted: Partial<Record<OmitReason, number>>
}

// ---------------------------------------------------------------------------
// Period rule
// ---------------------------------------------------------------------------

/** A lead belongs to the period it was captured (created) in: `start <= created_at < end`. */
export function isLeadInPeriod(row: Pick<LeadFeedRow, 'createdAt'>, period: ConvergencePeriod) {
  const capturedAt = row.createdAt.getTime()
  return capturedAt >= period.start.getTime() && capturedAt < period.end.getTime()
}

export function isClosedStatus(status: string): boolean {
  return status === 'won' || status === 'lost'
}

/**
 * The recorded close time. Only a won opportunity records one: the
 * `opportunity_to_won` conversion written when it is marked won. A lost
 * opportunity, or one marked won by bulk update or import, has none.
 */
export function recordedCloseTime(row: Pick<OpportunityFeedRow, 'status' | 'wonAt'>): Date | null {
  return row.status === 'won' ? row.wonAt : null
}

/**
 * Latest instant a closed opportunity can have closed: the recorded close
 * time, else `updated_at` (the status change itself updated the row, so the
 * close happened at or before it). `null` while the opportunity is open.
 */
export function closeTimeBound(
  row: Pick<OpportunityFeedRow, 'status' | 'wonAt' | 'updatedAt'>,
): Date | null {
  if (!isClosedStatus(row.status)) return null
  return recordedCloseTime(row) ?? row.updatedAt
}

/**
 * An opportunity belongs to a period when it was open during it or closed
 * within it: created before `end`, and still open or closed at/after `start`.
 * (Closed within `[start, end)` or after `end` both mean it was open at some
 * point of the period.)
 */
export function isOpportunityInPeriod(
  row: Pick<OpportunityFeedRow, 'status' | 'wonAt' | 'updatedAt' | 'createdAt'>,
  period: ConvergencePeriod,
) {
  if (row.createdAt.getTime() >= period.end.getTime()) return false
  const closedBy = closeTimeBound(row)
  return closedBy === null || closedBy.getTime() >= period.start.getTime()
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function percent(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

/** `closed_won` / `closed_lost` for closed deals, else the pipeline stage name. */
export function opportunityStage(row: Pick<OpportunityFeedRow, 'status' | 'stageName'>) {
  if (row.status === 'won') return CLOSED_WON_STAGE
  if (row.status === 'lost') return CLOSED_LOST_STAGE
  return nonEmpty(row.stageName) ?? null
}

/**
 * 0–1. Won = 1 and lost = 0 by definition; an open deal uses its own
 * probability, else its stage's default probability. `null` when neither is set.
 */
export function opportunityProbability(
  row: Pick<OpportunityFeedRow, 'status' | 'probability' | 'stageProbability'>,
) {
  if (row.status === 'won') return 1
  if (row.status === 'lost') return 0
  const pct = percent(row.probability) ?? percent(row.stageProbability)
  return pct === null ? null : pct / 100
}

export function opportunityValue(row: Pick<OpportunityFeedRow, 'value'>) {
  const raw = nonEmpty(row.value)
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/** `customerContactIds`: contacts that are customers (see ConvergenceFeedService). */
export function toConvergenceLead(
  row: LeadFeedRow,
  customerContactIds: ReadonlySet<string>,
): MapResult<ConvergenceLead> {
  const status = nonEmpty(row.status)
  if (status === undefined) return { omitted: 'missing_status' }

  const lead: ConvergenceLead = { lead_id: row.id, status }
  if (row.contactId) {
    lead.contact_id = row.contactId
    if (customerContactIds.has(row.contactId)) lead.customer_id = row.contactId
  }
  lead.captured_at = row.createdAt.toISOString()
  const source = nonEmpty(row.source)
  if (source !== undefined) lead.source = source
  if (row.score !== null && Number.isFinite(row.score)) lead.score = row.score
  return { item: lead }
}

export function toConvergenceOpportunity(
  row: OpportunityFeedRow,
  customerContactIds: ReadonlySet<string>,
): MapResult<ConvergenceOpportunity> {
  const stage = opportunityStage(row)
  if (stage === null) return { omitted: 'missing_stage' }
  const value = opportunityValue(row)
  if (value === null) return { omitted: 'missing_value' }
  const probability = opportunityProbability(row)
  if (probability === null) return { omitted: 'missing_probability' }

  const opportunity: ConvergenceOpportunity = { opportunity_id: row.id, stage, value, probability }
  if (row.contactId && customerContactIds.has(row.contactId)) {
    opportunity.customer_id = row.contactId
  }
  if (row.expectedCloseDate) opportunity.expected_close_at = row.expectedCloseDate.toISOString()
  const closedAt = recordedCloseTime(row)
  if (closedAt) opportunity.closed_at = closedAt.toISOString()
  return { item: opportunity }
}

/** Map rows, counting the ones left out by reason. */
export function collectFeed<R, T>(rows: R[], map: (row: R) => MapResult<T>): FeedResult<T> {
  const result: FeedResult<T> = { items: [], omitted: {} }
  for (const row of rows) {
    const mapped = map(row)
    if ('item' in mapped) {
      result.items.push(mapped.item)
    } else {
      result.omitted[mapped.omitted] = (result.omitted[mapped.omitted] ?? 0) + 1
    }
  }
  return result
}

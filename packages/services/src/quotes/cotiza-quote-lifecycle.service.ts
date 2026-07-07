import { contacts, engagements, externalReferences, quotes } from '@phynd/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { EngagementsService } from '../engagements/engagements.service'
import { ConflictError } from '../errors'
import { QuotesService } from './quotes.service'

/**
 * Cotiza quote-lifecycle intake.
 *
 * Cotiza POSTs quote lifecycle events to /api/v1/engagements/events using
 * the shared engagement-events contract, but — unlike the generic bus —
 * a Cotiza payload may arrive WITHOUT an engagement_id. This service:
 *
 *   1. Resolves the engagement:
 *      explicit engagement_id → cotiza quote external_reference → local
 *      quote → engagement, → cotiza customer external_reference → contact,
 *      → lowercased contact_email → contact, → contact's active
 *      engagement, auto-materializing a minimal engagement when the
 *      contact exists but has no active engagement.
 *   2. Materializes a local quotes row + external_references(entityType:
 *      'quote', provider: 'cotiza') mapping on first sight of a
 *      cotiza_quote_id so later lifecycle states resolve O(1).
 *   3. Records the inbound engagement_event (dedup-idempotent via the
 *      contract dedup_key `cotiza:<cotiza_quote_id>:<state>`; the canonical
 *      `quote_approved` milestone alias arrives with its own
 *      `cotiza:<id>:milestone:quote_approved` key per
 *      docs/ENGAGEMENT_EVENT_TAXONOMY.md).
 *   4. Reflects the lifecycle state onto the local quotes row:
 *        quote_sent     → sent (draft only)
 *        quote_approved → accepted via QuotesService.accept({source:'cotiza'})
 *                         so order/opportunity-won/conversion/milestone
 *                         logic runs (idempotent when already accepted)
 *        quote_rejected → declined (from draft/sent)
 *        quote_expired  → expired (from draft/sent)
 *        quote_viewed   → event-only (no quotes.status slot)
 *        quote_ordered  → event-only (accept() already owns order creation)
 *
 * Unresolvable events (no contact match) are reported as `skipped` — the
 * webhook route surfaces that as a 202, never a 500.
 */

export const COTIZA_QUOTE_LIFECYCLE_STATES = [
  'quote_sent',
  'quote_viewed',
  'quote_approved',
  'quote_rejected',
  'quote_expired',
  'quote_ordered',
] as const

export type CotizaQuoteLifecycleState = (typeof COTIZA_QUOTE_LIFECYCLE_STATES)[number]

/** `cotiza:quote_sent` / `quote_sent` → `quote_sent`; anything else → null. */
export function cotizaQuoteLifecycleState(eventType: string): CotizaQuoteLifecycleState | null {
  const name = eventType.replace(/^cotiza:/, '')
  return (COTIZA_QUOTE_LIFECYCLE_STATES as readonly string[]).includes(name)
    ? (name as CotizaQuoteLifecycleState)
    : null
}

/** True when an /api/v1/engagements/events payload is a Cotiza quote lifecycle event. */
export function isCotizaQuoteLifecycleEvent(payload: Record<string, unknown>): boolean {
  if (payload.source !== 'cotiza') return false
  const eventType = payload.event_type
  return typeof eventType === 'string' && cotizaQuoteLifecycleState(eventType) !== null
}

export type CotizaQuoteReflection = 'applied' | 'noop' | 'conflict' | 'event_only'

export type CotizaQuoteLifecycleResult =
  | { outcome: 'skipped'; reason: 'missing_event_fields' | 'unresolved_contact' }
  | {
      outcome: 'recorded' | 'deduplicated'
      engagementId: string
      contactId: string
      quoteId: string | null
      reflection: CotizaQuoteReflection
      autoMaterializedEngagement: boolean
      createdQuote: boolean
    }

interface NormalizedCotizaEvent {
  state: CotizaQuoteLifecycleState
  eventType: string
  engagementId: string | null
  cotizaQuoteId: string | null
  cotizaCustomerId: string | null
  contactEmail: string | null
  quoteNumber: string | null
  totalAmount: string | null
  currency: string | null
  status: string | null
  message: string | null
  dedupKey: string
  isCanonicalAlias: boolean
  metadata: Record<string, unknown>
}

const PORTAL_STATUS_BY_STATE: Record<CotizaQuoteLifecycleState, string> = {
  quote_sent: 'milestone',
  quote_viewed: 'in_progress',
  quote_approved: 'milestone',
  quote_rejected: 'failed',
  quote_expired: 'blocked',
  quote_ordered: 'completed',
}

type Db = ServiceContext['db']
type QuoteRow = typeof quotes.$inferSelect
type EngagementRow = typeof engagements.$inferSelect

export class CotizaQuoteLifecycleService {
  constructor(private readonly ctx: ServiceContext) {}

  async processWebhookPayload(
    payload: Record<string, unknown>,
  ): Promise<CotizaQuoteLifecycleResult> {
    const input = normalizePayload(payload)
    if (!input) {
      return { outcome: 'skipped', reason: 'missing_event_fields' }
    }
    return this.process(input)
  }

  private async process(input: NormalizedCotizaEvent): Promise<CotizaQuoteLifecycleResult> {
    const db = this.ctx.db
    const resolved = await resolveEngagement(db, input)
    if (!resolved) {
      return { outcome: 'skipped', reason: 'unresolved_contact' }
    }

    const { engagement, autoMaterialized } = resolved
    const ensured = await ensureLocalQuote(db, engagement, input)

    const engagementsService = new EngagementsService(this.ctx)
    const recorded = await engagementsService.recordEvent({
      engagementId: engagement.id,
      source: 'cotiza',
      eventType: input.eventType.startsWith('cotiza:') ? input.eventType : `cotiza:${input.state}`,
      status: input.status ?? PORTAL_STATUS_BY_STATE[input.state],
      message: input.message ?? defaultMessage(input, ensured?.quote ?? null),
      metadata: buildEventMetadata(input, engagement, ensured, autoMaterialized),
      dedupKey: input.dedupKey,
    })

    // Reflection runs on replays too — every branch is idempotent, so a
    // redelivery after a partial first attempt self-heals the quote row.
    const reflection = await this.reflectQuoteStatus(input.state, ensured?.quote ?? null)

    return {
      outcome: recorded.deduplicated ? 'deduplicated' : 'recorded',
      engagementId: engagement.id,
      contactId: engagement.contactId,
      quoteId: ensured?.quote.id ?? null,
      reflection,
      autoMaterializedEngagement: autoMaterialized,
      createdQuote: ensured?.created ?? false,
    }
  }

  private async reflectQuoteStatus(
    state: CotizaQuoteLifecycleState,
    quote: QuoteRow | null,
  ): Promise<CotizaQuoteReflection> {
    if (!quote) return 'event_only'
    if (state === 'quote_viewed' || state === 'quote_ordered') {
      // quote_viewed has no quotes.status slot; quote_ordered's order row is
      // owned by QuotesService.accept() at approval time.
      return 'event_only'
    }
    if (state === 'quote_approved') {
      return this.reflectApproval(quote)
    }

    const target =
      state === 'quote_sent' ? 'sent' : state === 'quote_rejected' ? 'declined' : 'expired'
    if (quote.status === target) return 'noop'

    const allowedFrom = state === 'quote_sent' ? ['draft'] : ['draft', 'sent']
    if (!allowedFrom.includes(quote.status)) {
      // e.g. Cotiza says rejected/expired but the CRM already accepted it —
      // never clobber a terminal local state from a webhook.
      return 'conflict'
    }

    await this.ctx.db.update(quotes).set({ status: target }).where(eq(quotes.id, quote.id))
    return 'applied'
  }

  private async reflectApproval(quote: QuoteRow): Promise<CotizaQuoteReflection> {
    const alreadyAccepted = quote.status === 'accepted'
    try {
      // Reuse the canonical acceptance flow: order creation, opportunity
      // won, conversions, and the quote_approved milestone event all run
      // (and are skipped internally when the quote was already accepted).
      await new QuotesService(this.ctx).accept(quote.id, { source: 'cotiza' })
      return alreadyAccepted ? 'noop' : 'applied'
    } catch {
      // accept() throws when the quote is declined/expired locally — a
      // state conflict, not a processing failure. Keep the event recorded.
      return 'conflict'
    }
  }
}

// ---------------------------------------------------------------------------
// Payload normalization
// ---------------------------------------------------------------------------

function normalizePayload(payload: Record<string, unknown>): NormalizedCotizaEvent | null {
  const eventType = asString(payload.event_type)
  if (!eventType) return null
  const state = cotizaQuoteLifecycleState(eventType)
  if (!state) return null

  const metadata = isRecord(payload.metadata) ? payload.metadata : {}
  const cotizaQuoteId = asString(metadata.cotiza_quote_id ?? payload.cotiza_quote_id)
  const explicitDedup = asString(payload.dedup_key)
  const timestamp = asString(payload.timestamp)

  const dedupKey =
    explicitDedup ??
    (cotizaQuoteId
      ? `cotiza:${cotizaQuoteId}:${state}`
      : ['cotiza', state, timestamp ?? ''].filter(Boolean).join(':'))

  return {
    state,
    eventType,
    engagementId: asString(payload.engagement_id ?? metadata.engagement_id),
    cotizaQuoteId,
    cotizaCustomerId: asString(
      metadata.cotiza_customer_id ?? metadata.customer_id ?? payload.cotiza_customer_id,
    ),
    contactEmail: asString(metadata.contact_email ?? payload.contact_email)?.toLowerCase() ?? null,
    quoteNumber: asString(metadata.quote_number ?? payload.quote_number),
    totalAmount: asAmount(metadata.total ?? metadata.total_amount ?? payload.total),
    currency: asString(metadata.currency ?? payload.currency),
    status: asString(payload.status),
    message: asString(payload.message),
    dedupKey,
    isCanonicalAlias:
      dedupKey.includes(':milestone:') || typeof metadata.canonical_milestone === 'string',
    metadata,
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asAmount(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2)
  if (typeof value === 'string' && value.length > 0 && Number.isFinite(Number(value))) return value
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Engagement resolution
// ---------------------------------------------------------------------------

async function resolveEngagement(
  db: Db,
  input: NormalizedCotizaEvent,
): Promise<{ engagement: EngagementRow; autoMaterialized: boolean } | null> {
  // 1. Explicit engagement_id from Cotiza wins when it resolves.
  if (input.engagementId) {
    const engagement = await findEngagementById(db, input.engagementId)
    if (engagement) return { engagement, autoMaterialized: false }
  }

  // 2. Known cotiza_quote_id → local quote → its engagement (O(1) path for
  //    every state after the first).
  const localQuote = await findQuoteByCotizaId(db, input.cotizaQuoteId)
  if (localQuote) {
    const engagement = await findEngagementForQuoteRow(db, localQuote)
    if (engagement) return { engagement, autoMaterialized: false }
  }

  // 3. Resolve the contact: cotiza customer external_reference, then
  //    lowercased email, then the linked quote's contact as a last resort.
  const contactId =
    (await findContactIdByCotizaCustomer(db, input.cotizaCustomerId)) ??
    (await findContactIdByEmail(db, input.contactEmail)) ??
    localQuote?.contactId ??
    null
  if (!contactId) return null

  // 4. Contact's first active engagement (matches the Pravara/Dhanam
  //    webhook convention), auto-materializing one when absent.
  const active = await findActiveEngagementForContact(db, contactId)
  if (active) return { engagement: active, autoMaterialized: false }

  const created = await createEngagementForContact(db, contactId, input)
  return { engagement: created, autoMaterialized: true }
}

async function findEngagementById(db: Db, id: string): Promise<EngagementRow | null> {
  const [row] = await db
    .select()
    .from(engagements)
    .where(and(eq(engagements.id, id), isNull(engagements.deletedAt)))
    .limit(1)
  return row ?? null
}

async function findQuoteByCotizaId(db: Db, cotizaQuoteId: string | null): Promise<QuoteRow | null> {
  if (!cotizaQuoteId) return null
  const [ref] = await db
    .select({ entityId: externalReferences.entityId })
    .from(externalReferences)
    .where(
      and(
        eq(externalReferences.entityType, 'quote'),
        eq(externalReferences.provider, 'cotiza'),
        eq(externalReferences.externalId, cotizaQuoteId),
      ),
    )
    .limit(1)
  if (!ref?.entityId) return null

  const [quote] = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, ref.entityId), isNull(quotes.deletedAt)))
    .limit(1)
  return quote ?? null
}

async function findEngagementForQuoteRow(db: Db, quote: QuoteRow): Promise<EngagementRow | null> {
  if (quote.opportunityId) {
    const [row] = await db
      .select()
      .from(engagements)
      .where(and(eq(engagements.opportunityId, quote.opportunityId), isNull(engagements.deletedAt)))
      .limit(1)
    if (row) return row
  }
  if (!quote.contactId) return null
  return findActiveEngagementForContact(db, quote.contactId)
}

async function findActiveEngagementForContact(
  db: Db,
  contactId: string,
): Promise<EngagementRow | null> {
  const [row] = await db
    .select()
    .from(engagements)
    .where(
      and(
        eq(engagements.contactId, contactId),
        eq(engagements.status, 'active'),
        isNull(engagements.deletedAt),
      ),
    )
    .orderBy(engagements.createdAt)
    .limit(1)
  return row ?? null
}

async function findContactIdByCotizaCustomer(
  db: Db,
  cotizaCustomerId: string | null,
): Promise<string | null> {
  if (!cotizaCustomerId) return null
  const [ref] = await db
    .select({ entityId: externalReferences.entityId })
    .from(externalReferences)
    .where(
      and(
        eq(externalReferences.entityType, 'contact'),
        eq(externalReferences.provider, 'cotiza'),
        eq(externalReferences.externalId, cotizaCustomerId),
      ),
    )
    .limit(1)
  if (!ref?.entityId) return null
  return confirmContactId(db, ref.entityId)
}

async function findContactIdByEmail(db: Db, email: string | null): Promise<string | null> {
  if (!email) return null
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.email, email), isNull(contacts.deletedAt)))
    .limit(1)
  return row?.id ?? null
}

async function confirmContactId(db: Db, contactId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)))
    .limit(1)
  return row?.id ?? null
}

async function createEngagementForContact(
  db: Db,
  contactId: string,
  input: NormalizedCotizaEvent,
): Promise<EngagementRow> {
  const label = input.quoteNumber ?? input.cotizaQuoteId
  const [row] = await db
    .insert(engagements)
    .values({
      contactId,
      projectName: (label ? `Cotiza quote ${label}` : 'Cotiza engagement').slice(0, 255),
      description: 'Auto-created from Cotiza quote-lifecycle intake',
      status: 'active',
    })
    .returning()
  if (!row) {
    throw new ConflictError('Failed to auto-materialize engagement for Cotiza event')
  }
  return row
}

// ---------------------------------------------------------------------------
// Local quote materialization
// ---------------------------------------------------------------------------

async function ensureLocalQuote(
  db: Db,
  engagement: EngagementRow,
  input: NormalizedCotizaEvent,
): Promise<{ quote: QuoteRow; created: boolean } | null> {
  if (!input.cotizaQuoteId) return null

  const existing = await findQuoteByCotizaId(db, input.cotizaQuoteId)
  if (existing) return { quote: existing, created: false }

  const [quote] = await db
    .insert(quotes)
    .values({
      quoteNumber: (input.quoteNumber ?? `COTIZA-${input.cotizaQuoteId}`).slice(0, 50),
      contactId: engagement.contactId,
      opportunityId: engagement.opportunityId,
      status: 'draft',
      totalAmount: input.totalAmount ?? undefined,
      currency: input.currency ?? undefined,
    })
    .returning()
  if (!quote) {
    throw new ConflictError('Failed to create local quote for Cotiza event')
  }

  await db.insert(externalReferences).values({
    entityType: 'quote',
    entityId: quote.id,
    provider: 'cotiza',
    externalId: input.cotizaQuoteId,
    externalType: 'quote',
    metadata: {
      quote_number: input.quoteNumber,
      cotiza_customer_id: input.cotizaCustomerId,
    },
  })

  return { quote, created: true }
}

// ---------------------------------------------------------------------------
// Event decoration
// ---------------------------------------------------------------------------

function defaultMessage(input: NormalizedCotizaEvent, quote: QuoteRow | null): string {
  const label = input.quoteNumber ?? quote?.quoteNumber ?? input.cotizaQuoteId ?? 'quote'
  const messages: Record<CotizaQuoteLifecycleState, string> = {
    quote_sent: `Quote ${label} sent to client`,
    quote_viewed: `Quote ${label} viewed by client`,
    quote_approved: `Quote ${label} approved by client`,
    quote_rejected: `Quote ${label} declined by client`,
    quote_expired: `Quote ${label} expired`,
    quote_ordered: `Order placed for quote ${label}`,
  }
  return messages[input.state]
}

function buildEventMetadata(
  input: NormalizedCotizaEvent,
  engagement: EngagementRow,
  ensured: { quote: QuoteRow; created: boolean } | null,
  autoMaterialized: boolean,
): Record<string, unknown> {
  return {
    ...input.metadata,
    cotiza_quote_id: input.cotizaQuoteId,
    quote_id: ensured?.quote.id ?? null,
    quote_number: input.quoteNumber ?? ensured?.quote.quoteNumber ?? null,
    contact_id: engagement.contactId,
    ...(input.isCanonicalAlias ? { canonical_milestone: 'quote_approved' } : {}),
    ...(autoMaterialized ? { auto_materialized_engagement: true } : {}),
    ...(ensured?.created ? { created_quote: true } : {}),
  }
}

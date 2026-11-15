import { getCacheManager } from '@/lib/federation/clients'
import {
  BOOKING_EVENT_TYPE,
  LEAD_INTAKE_ORIGIN_LABEL,
  LEAD_INTAKE_PROVIDER,
  type LeadIntakeSource,
  type LeadQuote,
  type NewLeadNotification,
  QUOTE_EVENT_TYPE,
  formatBookingStart,
  isLeadIntakeSource,
  leadEventSource,
  nextBusinessDayDueAt,
  notifyNewLead,
  quoteLabel,
  quoteSummary,
  readLeadQuote,
} from '@/lib/webhooks/lead-intake'
import { checkRateLimit } from '@/lib/webhooks/rate-limiter'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { webhookEvents } from '@phynd/db/schema'
import { validateMadfamSignature } from '@phynd/federation'
import { createLogger } from '@phynd/logging'
import {
  ActivitiesService,
  ContactsService,
  LeadsService,
  NotesService,
  PipelinesService,
  type Transaction,
  createServiceContext,
  withTransaction,
} from '@phynd/services'
import { sanitizeLeadAttribution } from '@phynd/services/leads/lead-attribution'
import type { AuthContext } from '@phynd/types/auth'
import type { LeadAttribution } from '@phynd/types/crm'
import { and, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

// Lead intake → PhyndCRM. Three senders share one envelope: a meeting booked in
// Kalya (`kalya.booking.created`), a contact form on the public site
// (`site.lead.captured`) and a quote requested on the quoting platform
// (`cotiza.quote.requested`). Each becomes a contact + a lead in the default
// pipeline with its source and attribution, a note with the prospect's words,
// a follow-up task and one notification email.
//
// Same doctrine as the nauta webhook one directory over:
//   - `x-madfam-signature` (t=<unix>,v1=<hmac of "t.body">) verified with
//     `PHYND_CRM_LEAD_INTAKE_SECRET`, a key used by this route only; 503 when
//     it is unset, 401 on a bad signature. Bodies over 64 KB are refused (413)
//     before the signature is checked.
//   - `schema_version` must be '1' (422 otherwise).
//   - exactly once per event_id and source: the rows and the webhook_events
//     record are written in one transaction, serialized per event_id (and per
//     email address) with transaction-scoped advisory locks, so a retried or
//     concurrent delivery is acknowledged and creates nothing.
//   - an unknown event type from a known source is acknowledged and recorded.
//   - the notification is sent once, after the transaction commits, and is
//     best effort.
//
// Envelope:
//   {
//     schema_version: '1',
//     event_id: string,            // uuid, stable per booking / site lead / quote
//     event_type: 'kalya.booking.created' | 'site.lead.captured'
//               | 'cotiza.quote.requested',
//     source: 'kalya' | 'madfam-site' | 'cotiza',
//     occurred_at: ISO-8601,
//     payload: {
//       lead: { name, email, phone?, company?, message? },
//       context?: { page?, locale?, tenant?, plan_interest? },
//       attribution?: { utm_source?, utm_medium?, utm_campaign?, utm_content?,
//                       utm_term?, referrer? },
//       booking?: { id, event_type_name?, starts_at, timezone?, host_name? },
//       quote?: { id, number?, total?, currency?, item_count? }  // required
//                                          // (with its id) on a quote request
//     }
//   }

const logger = createLogger('web:webhook:lead-intake')

/** Largest request body read, in bytes. A lead event is a few kilobytes. */
const MAX_BODY_BYTES = 64 * 1024
/** `contacts.name`, `contacts.email` and `contacts.company` are varchar(255). */
const CONTACT_TEXT_MAX = 255
/** `contacts.phone` is varchar(50). */
const CONTACT_PHONE_MAX = 50
/** A phone too long for the contact is kept in the note, up to this length. */
const NOTE_PHONE_MAX = 200
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type LeadIntakeEnvelope = {
  eventId: string
  eventType: string
  source: LeadIntakeSource
  payload: Record<string, unknown>
  raw: Record<string, unknown>
}

/** The prospect's fields, already cut to what the columns hold. */
type LeadFields = {
  /** Trimmed and in lower case. */
  email: string
  name?: string
  company?: string
  /** Set only when it fits `contacts.phone`. */
  phone?: string
  /** The phone as sent (capped), for the note and the email. */
  phoneAsSent?: string
  message?: string
  planInterest?: string
  /** Set on a quote request only. */
  quote: LeadQuote | null
  attribution: LeadAttribution | null
}

type IntakeOutcome =
  | { deduplicated: true }
  | { deduplicated: false; notification: NewLeadNotification | null }

type PhyndServiceContext = ReturnType<typeof createServiceContext>

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function readObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Postgres counts varchar length in characters: count code points, never split one. */
function charLength(value: string): number {
  return Array.from(value).length
}

function cut(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined
  return charLength(value) > max ? Array.from(value).slice(0, max).join('') : value
}

function parseEnvelope(raw: Record<string, unknown>): LeadIntakeEnvelope | { error: string } {
  const eventId = readString(raw.event_id)
  const eventType = readString(raw.event_type)
  if (!eventId) return { error: 'event_id is required' }
  if (!eventType) return { error: 'event_type is required' }
  if (!isLeadIntakeSource(raw.source)) {
    return { error: "source must be 'kalya', 'madfam-site' or 'cotiza'" }
  }
  const expectedSource = leadEventSource(eventType)
  if (expectedSource && expectedSource !== raw.source) {
    return { error: `event_type '${eventType}' must come from source '${expectedSource}'` }
  }
  return { eventId, eventType, source: raw.source, payload: readObject(raw.payload), raw }
}

/**
 * The lead a lead event carries. `null` when it has no email (both senders
 * require one, so that is a malformed relay: acknowledged and recorded only);
 * an error when the email cannot be stored or is not an address.
 */
function readLead(event: LeadIntakeEnvelope): LeadFields | null | { error: string } {
  const { payload } = event
  const lead = readObject(payload.lead)
  const context = readObject(payload.context)

  const rawEmail = readString(lead.email)
  if (!rawEmail) return null
  if (charLength(rawEmail) > CONTACT_TEXT_MAX || !EMAIL_SHAPE.test(rawEmail)) {
    return { error: 'lead.email is not a valid address of at most 255 characters' }
  }

  // A quote request without a usable quote id cannot be followed up.
  const quote = event.eventType === QUOTE_EVENT_TYPE ? readLeadQuote(payload.quote) : null
  if (event.eventType === QUOTE_EVENT_TYPE && !quote) {
    return { error: 'quote.id is required (a string of at most 100 characters)' }
  }

  const phoneAsSent = readString(lead.phone)
  const phoneFits = phoneAsSent !== undefined && charLength(phoneAsSent) <= CONTACT_PHONE_MAX

  return {
    email: rawEmail.toLowerCase(),
    name: cut(readString(lead.name), CONTACT_TEXT_MAX),
    company: cut(readString(lead.company), CONTACT_TEXT_MAX),
    phone: phoneFits ? phoneAsSent : undefined,
    phoneAsSent: cut(phoneAsSent, NOTE_PHONE_MAX),
    message: readString(lead.message),
    planInterest: readString(context.plan_interest),
    quote,
    // landing_page and tenant come from the context only, the quote keys from
    // the validated quote only (never from the attribution block); the
    // sanitiser keeps the known keys, strings only, cut to their length.
    attribution: sanitizeLeadAttribution({
      ...readObject(payload.attribution),
      landing_page: context.page,
      tenant: context.tenant,
      quote_id: quote?.id,
      quote_number: quote?.number,
      quote_total: quote?.total,
      quote_currency: quote?.total ? quote.currency : undefined,
      booking: event.eventType === BOOKING_EVENT_TYPE ? payload.booking : undefined,
    }),
  }
}

/**
 * The request body as text, or `null` when it is larger than `limit` bytes.
 * Reads the stream itself and stops at the limit, so a missing or wrong
 * content-length cannot make the route buffer more.
 */
async function readBodyWithin(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function tooLarge(): NextResponse {
  return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
}

/**
 * A signed body as an event and, for a lead event, its lead fields; or the
 * response that rejects it (400 malformed, 422 unsupported or invalid).
 */
function parseDelivery(
  rawBody: string,
): { event: LeadIntakeEnvelope; lead: LeadFields | null } | NextResponse {
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const raw = readObject(body)
  if (raw.schema_version !== '1') {
    return NextResponse.json({ error: "schema_version must be '1'" }, { status: 422 })
  }

  const event = parseEnvelope(raw)
  if ('error' in event) {
    return NextResponse.json({ error: event.error }, { status: 400 })
  }

  const isLeadEvent = leadEventSource(event.eventType) !== undefined
  if (!isLeadEvent) {
    // Recorded only: a new event type from a signed, known source is not a
    // reason to fail the sender's request.
    logger.info(
      { eventType: event.eventType, source: event.source },
      'unhandled lead-intake event type',
    )
  }
  const lead = isLeadEvent ? readLead(event) : null
  if (lead && 'error' in lead) {
    return NextResponse.json({ error: lead.error }, { status: 422 })
  }

  return { event, lead }
}

export async function POST(req: Request): Promise<NextResponse> {
  // Read as is: the key is opaque, and lead senders do not hold the shared
  // events key, so there is deliberately no fallback to it.
  const secret = process.env.PHYND_CRM_LEAD_INTAKE_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { allowed, remaining } = await checkRateLimit(ip)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' } },
    )
  }

  const declaredLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return tooLarge()
  const rawBody = await readBodyWithin(req, MAX_BODY_BYTES)
  if (rawBody === null) return tooLarge()

  const sigResult = validateMadfamSignature(rawBody, req.headers.get('x-madfam-signature'), secret)
  if (!sigResult.ok) {
    logger.warn({ reason: sigResult.reason }, 'rejected lead-intake webhook')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const delivery = parseDelivery(rawBody)
  if (delivery instanceof NextResponse) return delivery
  const { event, lead } = delivery

  let outcome: IntakeOutcome
  try {
    outcome = await getDb().transaction((tx) => storeEvent(tx, event, lead))
  } catch (error) {
    logger.error(
      { err: error, eventId: event.eventId, source: event.source },
      'lead-intake webhook processing error',
    )
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }

  const headers = { 'X-RateLimit-Remaining': String(remaining) }
  if (outcome.deduplicated) {
    return NextResponse.json({ received: true, deduplicated: true }, { headers })
  }

  if (outcome.notification) {
    logger.info(
      {
        contactId: outcome.notification.contactId,
        leadId: outcome.notification.leadId,
        source: event.source,
        hasMessage: outcome.notification.message !== undefined,
        hasAttribution: outcome.notification.attribution !== null,
      },
      'lead captured',
    )
    // After the commit, so a rolled-back attempt never sends one and a replay
    // (which returns above) never sends a second. Best effort.
    await notifyNewLead(outcome.notification)
  }

  return NextResponse.json({ received: true }, { headers })
}

/**
 * The whole unit of work for one delivery, inside one transaction. The
 * event lock comes first and the email lock second, always in that order.
 * `webhook_events` has no unique key on the event id, so the lock is what
 * makes the "seen?" check and the insert below atomic: a concurrent delivery
 * of the same event waits here, then finds the record and stops.
 */
async function storeEvent(
  tx: Transaction,
  event: LeadIntakeEnvelope,
  lead: LeadFields | null,
): Promise<IntakeOutcome> {
  await advisoryLock(tx, `phynd:lead-intake:event:${event.eventId}`)
  if (await hasSeenEvent(tx, event)) return { deduplicated: true }

  const notification = lead ? await storeLead(tx, event, lead) : null
  await recordWebhookEvent(tx, event)
  return { deduplicated: false, notification }
}

async function advisoryLock(tx: Transaction, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
}

async function hasSeenEvent(tx: Transaction, event: LeadIntakeEnvelope): Promise<boolean> {
  const prior = await tx
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.provider, LEAD_INTAKE_PROVIDER[event.source]),
        sql`${webhookEvents.payload} ->> 'event_id' = ${event.eventId}`,
      ),
    )
    .limit(1)

  return prior.length > 0
}

async function recordWebhookEvent(tx: Transaction, event: LeadIntakeEnvelope): Promise<void> {
  await tx.insert(webhookEvents).values({
    provider: LEAD_INTAKE_PROVIDER[event.source],
    // The column holds 100 characters; the payload keeps the full value.
    eventType: event.eventType.slice(0, 100),
    payload: event.raw,
    processedAt: new Date(),
  })
}

/** Service context whose queries run on the delivery's transaction. */
function createIntakeContext(source: LeadIntakeSource, tx: Transaction): PhyndServiceContext {
  const auth: AuthContext = {
    userId: `service:${source}`,
    tenantId: DEFAULT_TENANT_ID,
    roles: ['service'],
    scopes: ['*'],
    accessToken: 'internal:lead-intake-webhook',
  }
  return withTransaction(createServiceContext(getDb(), getCacheManager(), auth), tx)
}

async function storeLead(
  tx: Transaction,
  event: LeadIntakeEnvelope,
  lead: LeadFields,
): Promise<NewLeadNotification> {
  const { source } = event
  const ctx = createIntakeContext(source, tx)
  const { attribution } = lead

  // `contacts.email` has no unique key either: two first deliveries for the
  // same new address (different event ids) take turns here, and the second
  // finds the contact the first created. Matched regardless of letter case;
  // new contacts are stored in lower case. An existing contact is reused as
  // it is.
  // `lead.email` is already in lower case.
  await advisoryLock(tx, `phynd:lead-intake:email:${lead.email}`)
  const contactsService = new ContactsService(ctx)
  const contact =
    (await contactsService.getByEmailIgnoringCase(lead.email)) ??
    (await contactsService.create({
      name: lead.name ?? lead.email.split('@')[0] ?? lead.email,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
    }))

  const crmLead = await createDefaultLead(ctx, contact.id, source, attribution)

  // The prospect's own words go on the contact, followed by where they came
  // from, so the first person to open the record reads both.
  await new NotesService(ctx).create({
    content: [lead.message ?? '(sin mensaje)', '', ...originLines(source, lead)].join('\n'),
    entityType: 'contact',
    entityId: contact.id,
  })

  const displayName = lead.name ?? lead.email
  const followUpDueAt = crmLead
    ? await openFollowUp(ctx, {
        leadId: crmLead.id,
        source,
        name: displayName,
        attribution,
        quote: lead.quote,
      })
    : null

  return {
    source,
    contactId: contact.id,
    leadId: crmLead?.id ?? null,
    name: displayName,
    email: lead.email,
    company: lead.company,
    phone: lead.phoneAsSent,
    message: lead.message,
    planInterest: lead.planInterest,
    quote: lead.quote,
    page: attribution?.landing_page,
    attribution,
    followUpDueAt,
  }
}

/** Short origin lines for the contact note: page, plan, quote, tenant, meeting, campaign. */
function originLines(source: LeadIntakeSource, lead: LeadFields): string[] {
  const { attribution, planInterest } = lead
  const origin = [`— vía ${LEAD_INTAKE_ORIGIN_LABEL[source]}`]
  if (attribution?.landing_page) origin.push(attribution.landing_page)
  if (planInterest) origin.push(`interés: ${planInterest}`)
  const lines = [origin.join(' · ')]

  if (lead.quote) lines.push(`— ${quoteSummary(lead.quote)}`)
  if (attribution?.tenant) lines.push(`— cuenta de origen (tenant): ${attribution.tenant}`)

  const meeting = bookingSummary(attribution)
  if (meeting) lines.push(`— reunión: ${meeting}`)

  const utm = [attribution?.utm_source, attribution?.utm_medium, attribution?.utm_campaign]
  if (utm.some((value) => value !== undefined)) {
    lines.push(`— utm: ${utm.map((value) => value ?? '—').join(' / ')}`)
  }

  if (lead.phoneAsSent && lead.phone === undefined) {
    lines.push(`— teléfono (no cabe en el contacto): ${lead.phoneAsSent}`)
  }
  return lines
}

/** Meeting type, start with its time zone and host, whichever are known. */
function bookingSummary(attribution: LeadAttribution | null): string | undefined {
  const booking = attribution?.booking
  if (!booking) return undefined
  const parts = [
    booking.event_type_name,
    formatBookingStart(booking.starts_at, booking.timezone),
    booking.host_name ? `con ${booking.host_name}` : undefined,
  ].filter((part): part is string => part !== undefined)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * One follow-up task on the lead, due the next business day. It has no owner
 * yet (a new lead has none); it shows on the lead's timeline and in the
 * activities list, and whoever takes it sets its owner. Best effort: it runs
 * in a savepoint, so a failure rolls back only the task, is logged, and the
 * lead is still stored.
 */
async function openFollowUp(
  ctx: PhyndServiceContext,
  input: {
    leadId: string
    source: LeadIntakeSource
    name: string
    attribution: LeadAttribution | null
    quote: LeadQuote | null
  },
): Promise<Date | null> {
  const dueAt = nextBusinessDayDueAt()
  const meeting = bookingSummary(input.attribution)
  // The quote label goes first so a long name cannot cut it off.
  const subject = input.quote ? `cotización ${quoteLabel(input.quote)} · ${input.name}` : input.name
  try {
    await ctx.db.transaction((savepoint) =>
      new ActivitiesService(withTransaction(ctx, savepoint)).create({
        type: 'task',
        // `activities.title` is varchar(255).
        title: cut(`Dar seguimiento: ${subject}`, CONTACT_TEXT_MAX) ?? 'Dar seguimiento',
        description: [
          `Lead por ${LEAD_INTAKE_ORIGIN_LABEL[input.source]}.`,
          meeting ? `Reunión: ${meeting}` : undefined,
          input.quote ? `Solicitud de ${quoteSummary(input.quote)}.` : undefined,
        ]
          .filter((part): part is string => part !== undefined)
          .join(' '),
        dueAt,
        entityType: 'lead',
        entityId: input.leadId,
        ownerId: null,
      }),
    )
    return dueAt
  } catch (error) {
    logger.warn({ err: error, leadId: input.leadId }, 'lead follow-up task not created')
    return null
  }
}

async function createDefaultLead(
  ctx: PhyndServiceContext,
  contactId: string,
  source: LeadIntakeSource,
  attribution: LeadAttribution | null,
) {
  const pipelinesService = new PipelinesService(ctx)
  const pipeline = await pipelinesService.getDefault()
  if (!pipeline) return null

  const stages = await pipelinesService.getStages(pipeline.id)
  const firstStage = stages[0]
  if (!firstStage) return null

  // `leads.source` is varchar(100); the source is one of two short constants.
  return new LeadsService(ctx).create({
    contactId,
    source,
    attribution,
    pipelineId: pipeline.id,
    stageId: firstStage.id,
  })
}

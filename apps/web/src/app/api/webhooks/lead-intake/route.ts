import { getCacheManager } from '@/lib/federation/clients'
import {
  BOOKING_EVENT_TYPE,
  LEAD_INTAKE_ORIGIN_LABEL,
  type LeadIntakeSource,
  formatBookingStart,
  isLeadIntakeSource,
  leadEventSource,
  nextBusinessDayDueAt,
  notifyNewLead,
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
  createServiceContext,
} from '@phynd/services'
import { sanitizeLeadAttribution } from '@phynd/services/leads/lead-attribution'
import type { AuthContext } from '@phynd/types/auth'
import type { LeadAttribution } from '@phynd/types/crm'
import { and, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

// Lead intake → PhyndCRM. Two senders share one envelope: a meeting booked in
// Kalya (`kalya.booking.created`) and a contact form on the public site
// (`site.lead.captured`). Each becomes a contact + a lead in the default
// pipeline with its source and attribution, a note with the prospect's words,
// a follow-up task and one notification email.
//
// Same doctrine as the nauta webhook one directory over:
//   - `x-madfam-signature` (t=<unix>,v1=<hmac of "t.body">) verified with
//     `PHYND_CRM_EVENTS_SECRET`; 503 when the secret is unset, 401 on a bad
//     signature.
//   - event_id dedup via webhook_events, per source (the source is the
//     `provider`), so a retried delivery is acknowledged and creates nothing.
//   - an unknown event type from a known source is acknowledged and recorded.
//   - the notification is best effort, after the rows are stored.
//
// Envelope:
//   {
//     schema_version: '1',
//     event_id: string,            // uuid, stable per booking / per site lead
//     event_type: 'kalya.booking.created' | 'site.lead.captured',
//     source: 'kalya' | 'madfam-site',
//     occurred_at: ISO-8601,
//     payload: {
//       lead: { name, email, phone?, company?, message? },
//       context?: { page?, locale?, tenant?, plan_interest? },
//       attribution?: { utm_source?, utm_medium?, utm_campaign?, utm_content?,
//                       utm_term?, referrer? },
//       booking?: { id, event_type_name?, starts_at, timezone?, host_name? }
//     }
//   }

const logger = createLogger('web:webhook:lead-intake')

type LeadIntakeEnvelope = {
  eventId: string
  eventType: string
  source: LeadIntakeSource
  payload: Record<string, unknown>
  raw: Record<string, unknown>
}

type PhyndServiceContext = ReturnType<typeof createServiceContext>

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function readObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function parseEnvelope(body: unknown): LeadIntakeEnvelope | { error: string } {
  const raw = readObject(body)
  const eventId = readString(raw.event_id)
  const eventType = readString(raw.event_type)
  if (!eventId) return { error: 'event_id is required' }
  if (!eventType) return { error: 'event_type is required' }
  if (!isLeadIntakeSource(raw.source)) {
    return { error: "source must be 'kalya' or 'madfam-site'" }
  }
  const expectedSource = leadEventSource(eventType)
  if (expectedSource && expectedSource !== raw.source) {
    return { error: `event_type '${eventType}' must come from source '${expectedSource}'` }
  }
  return { eventId, eventType, source: raw.source, payload: readObject(raw.payload), raw }
}

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.PHYND_CRM_EVENTS_SECRET
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

  const rawBody = await req.text()
  const sigResult = validateMadfamSignature(rawBody, req.headers.get('x-madfam-signature'), secret)
  if (!sigResult.ok) {
    logger.warn({ reason: sigResult.reason }, 'rejected lead-intake webhook')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = parseEnvelope(body)
  if ('error' in event) {
    return NextResponse.json({ error: event.error }, { status: 400 })
  }

  if (await hasSeenEvent(event)) {
    return NextResponse.json(
      { received: true, deduplicated: true },
      { headers: { 'X-RateLimit-Remaining': String(remaining) } },
    )
  }

  try {
    await processEvent(event)
    await recordWebhookEvent(event)
  } catch (error) {
    logger.error(
      { err: error, eventId: event.eventId, source: event.source },
      'lead-intake webhook processing error',
    )
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }

  return NextResponse.json(
    { received: true },
    { headers: { 'X-RateLimit-Remaining': String(remaining) } },
  )
}

async function hasSeenEvent(event: LeadIntakeEnvelope): Promise<boolean> {
  const prior = await getDb()
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.provider, event.source),
        sql`${webhookEvents.payload} ->> 'event_id' = ${event.eventId}`,
      ),
    )
    .limit(1)

  return prior.length > 0
}

async function recordWebhookEvent(event: LeadIntakeEnvelope): Promise<void> {
  await getDb()
    .insert(webhookEvents)
    .values({
      provider: event.source,
      // The column holds 100 characters; the payload keeps the full value.
      eventType: event.eventType.slice(0, 100),
      payload: event.raw,
      processedAt: new Date(),
    })
}

function createIntakeContext(source: LeadIntakeSource): PhyndServiceContext {
  const auth: AuthContext = {
    userId: `service:${source}`,
    tenantId: DEFAULT_TENANT_ID,
    roles: ['service'],
    scopes: ['*'],
    accessToken: 'internal:lead-intake-webhook',
  }
  return createServiceContext(getDb(), getCacheManager(), auth)
}

async function processEvent(event: LeadIntakeEnvelope): Promise<void> {
  if (leadEventSource(event.eventType) === undefined) {
    // Recorded by recordWebhookEvent either way: a new event type from a
    // signed, known source is not a reason to fail the sender's request.
    logger.info(
      { eventType: event.eventType, source: event.source },
      'unhandled lead-intake event type',
    )
    return
  }
  await handleLeadEvent(createIntakeContext(event.source), event)
}

async function handleLeadEvent(ctx: PhyndServiceContext, event: LeadIntakeEnvelope): Promise<void> {
  const { source, payload } = event
  const lead = readObject(payload.lead)
  const context = readObject(payload.context)
  const email = readString(lead.email)
  // No email, no lead: both senders require it, so an arrival without one is a
  // malformed relay rather than a prospect. Acknowledged and recorded only.
  if (!email) return

  const name = readString(lead.name)
  const company = readString(lead.company)
  const phone = readString(lead.phone)
  const message = readString(lead.message)
  const planInterest = readString(context.plan_interest)

  const attribution = sanitizeLeadAttribution({
    ...readObject(payload.attribution),
    landing_page: context.page,
    booking: event.eventType === BOOKING_EVENT_TYPE ? payload.booking : undefined,
  })

  // Addresses are matched as sent and then in lower case, and new contacts are
  // stored in lower case, so the same person arriving with different casing
  // ends up on one contact. An existing contact is reused as it is.
  const contactsService = new ContactsService(ctx)
  const normalizedEmail = email.toLowerCase()
  const existing =
    (await contactsService.getByEmail(email)) ??
    (normalizedEmail !== email ? await contactsService.getByEmail(normalizedEmail) : null)
  const contact =
    existing ??
    (await contactsService.create({
      name: name ?? normalizedEmail.split('@')[0] ?? normalizedEmail,
      email: normalizedEmail,
      phone,
      company,
    }))

  const crmLead = await createDefaultLead(ctx, contact.id, source, attribution)

  // The prospect's own words go on the contact, followed by where they came
  // from, so the first person to open the record reads both.
  await new NotesService(ctx).create({
    content: [
      message ?? '(sin mensaje)',
      '',
      ...originLines(source, attribution, planInterest),
    ].join('\n'),
    entityType: 'contact',
    entityId: contact.id,
  })

  const followUpDueAt = crmLead
    ? await openFollowUp(ctx, {
        leadId: crmLead.id,
        source,
        name: name ?? email,
        attribution,
      })
    : null

  logger.info(
    {
      contactId: contact.id,
      leadId: crmLead?.id ?? null,
      source,
      hasMessage: message !== undefined,
      hasAttribution: attribution !== null,
    },
    'lead captured',
  )

  // Best effort, after the rows are stored (see notifyNewLead).
  await notifyNewLead({
    source,
    contactId: contact.id,
    leadId: crmLead?.id ?? null,
    name: name ?? email,
    email,
    company,
    phone,
    message,
    planInterest,
    page: attribution?.landing_page,
    attribution,
    followUpDueAt,
  })
}

/** Short origin lines for the contact note: page, plan, meeting, campaign. */
function originLines(
  source: LeadIntakeSource,
  attribution: LeadAttribution | null,
  planInterest: string | undefined,
): string[] {
  const origin = [`— vía ${LEAD_INTAKE_ORIGIN_LABEL[source]}`]
  if (attribution?.landing_page) origin.push(attribution.landing_page)
  if (planInterest) origin.push(`interés: ${planInterest}`)
  const lines = [origin.join(' · ')]

  const meeting = bookingSummary(attribution)
  if (meeting) lines.push(`— reunión: ${meeting}`)

  const utm = [attribution?.utm_source, attribution?.utm_medium, attribution?.utm_campaign]
  if (utm.some((value) => value !== undefined)) {
    lines.push(`— utm: ${utm.map((value) => value ?? '—').join(' / ')}`)
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
 * activities list. Best effort: the lead is already stored, so a failure here
 * is logged and the webhook still succeeds.
 */
async function openFollowUp(
  ctx: PhyndServiceContext,
  input: {
    leadId: string
    source: LeadIntakeSource
    name: string
    attribution: LeadAttribution | null
  },
): Promise<Date | null> {
  const dueAt = nextBusinessDayDueAt()
  const meeting = bookingSummary(input.attribution)
  try {
    await new ActivitiesService(ctx).create({
      type: 'task',
      title: `Dar seguimiento: ${input.name}`.slice(0, 255),
      description: [`Lead por ${LEAD_INTAKE_ORIGIN_LABEL[input.source]}.`, meeting]
        .filter((part): part is string => part !== undefined)
        .join(' Reunión: '),
      dueAt,
      entityType: 'lead',
      entityId: input.leadId,
      ownerId: null,
    })
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

  return new LeadsService(ctx).create({
    contactId,
    source,
    attribution,
    pipelineId: pipeline.id,
    stageId: firstStage.id,
  })
}

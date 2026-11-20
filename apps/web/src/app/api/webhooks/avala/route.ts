import { clientAddress } from '@/lib/client-address'
import { getCacheManager } from '@/lib/federation/clients'
import { finishIntakeLead } from '@/lib/webhooks/intake-lead'
import { type LeadAlert, leadTierOf, sendLeadAlert } from '@/lib/webhooks/lead-alert'
import { checkRateLimit } from '@/lib/webhooks/rate-limiter'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { contacts, conversions, webhookEvents } from '@phynd/db/schema'
import { validateMadfamSignature } from '@phynd/federation'
import { createLogger } from '@phynd/logging'
import {
  ContactsService,
  ConversionsService,
  LeadsService,
  NotesService,
  PipelinesService,
  type Transaction,
  VisitorTrackingService,
  createServiceContext,
  withTransaction,
} from '@phynd/services'
import {
  avalaLeadAttribution,
  avalaLeadMessage,
  avalaMessageNote,
} from '@phynd/services/leads/avala-lead-context'
import { isTestLead } from '@phynd/services/leads/lead-qualification'
import type { AuthContext } from '@phynd/types/auth'
import type { LeadAttribution } from '@phynd/types/crm'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('web:webhook:avala')

// Avala → PhyndCRM. Exactly once per delivery: every row an event writes
// (contact, lead, note, owner and first-contact task, visitor session,
// conversion) and its `webhook_events` record go in ONE transaction, serialized
// per event id with a transaction-scoped advisory lock, so a failure anywhere
// rolls the whole delivery back and Avala's retry starts clean, and a retry or
// a concurrent copy of a delivery that did commit is acknowledged as a
// duplicate and writes nothing. A lead event is also serialized per Avala lead
// id: a lead already stored for that id (a re-emitted event under a new event
// id) is never created twice. The new-lead alert is sent once, after commit.

type AvalaOutcome = { deduplicated: true } | { deduplicated: false; alert: LeadAlert | null }

type AvalaWebhookEnvelope = {
  schema_version?: string
  event_id?: string
  event_type?: string
  source?: string
  occurred_at?: string
  aggregate?: {
    type?: string
    id?: string
  }
  payload?: Record<string, unknown>
}

type PhyndServiceContext = ReturnType<typeof createServiceContext>

const SERVICE_AUTH: AuthContext = {
  userId: 'service:avala',
  tenantId: DEFAULT_TENANT_ID,
  roles: ['service'],
  scopes: ['*'],
  accessToken: 'internal:avala-webhook',
}

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.PHYND_CRM_EVENTS_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  const ip = clientAddress(req.headers)
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
    logger.warn({ reason: sigResult.reason }, 'rejected Avala webhook')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: AvalaWebhookEnvelope
  try {
    event = JSON.parse(rawBody) as AvalaWebhookEnvelope
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const shapeError = validateEvent(event)
  if (shapeError) {
    return NextResponse.json({ error: shapeError }, { status: 400 })
  }

  const eventId = event.event_id ?? ''
  const eventType = event.event_type ?? ''

  const headers = { 'X-RateLimit-Remaining': String(remaining) }
  const duplicate = () =>
    NextResponse.json({ received: true, status: 'duplicate', event_id: eventId }, { headers })

  let outcome: AvalaOutcome
  try {
    // Fast path only; the authoritative check runs under the lock below.
    if (await hasSeenEvent(getDb(), eventId)) return duplicate()
    outcome = await getDb().transaction((tx) => storeEvent(tx, event))
  } catch (err) {
    logger.error(
      { err, event_id: eventId, event_type: eventType },
      'Avala webhook processing failed',
    )
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }

  if (outcome.deduplicated) return duplicate()
  // After the commit, so a rolled-back attempt never alerts and a retry (a
  // duplicate above) never alerts twice. Best effort, never throws.
  if (outcome.alert) await sendLeadAlert(outcome.alert)

  return NextResponse.json(
    { received: true, status: 'processed', event_id: eventId, event_type: eventType },
    { headers },
  )
}

/**
 * One delivery's whole unit of work. Lock order is fixed: event id, then (in
 * the lead handler) Avala lead id, then email address.
 */
async function storeEvent(tx: Transaction, event: AvalaWebhookEnvelope): Promise<AvalaOutcome> {
  const eventId = event.event_id ?? ''
  await advisoryLock(tx, `phynd:avala:event:${eventId}`)
  if (await hasSeenEvent(tx, eventId)) return { deduplicated: true }

  const ctx = withTransaction(createAvalaContext(), tx)
  const alert = await processAvalaEvent(ctx, event)
  await recordWebhookEvent(tx, event)
  return { deduplicated: false, alert }
}

/** Transaction-scoped: released when the delivery's transaction ends. */
async function advisoryLock(db: Pick<Transaction, 'execute'>, key: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
}

function validateEvent(event: AvalaWebhookEnvelope): string | null {
  if (event.schema_version !== '1') return `unsupported schema_version: ${event.schema_version}`
  if (event.source !== 'avala') return `unsupported source: ${event.source}`
  if (!event.event_id) return 'missing field: event_id'
  if (!event.event_type) return 'missing field: event_type'
  if (!event.occurred_at) return 'missing field: occurred_at'
  if (!event.payload || typeof event.payload !== 'object') return 'missing field: payload'
  return null
}

async function hasSeenEvent(
  db: Transaction | ReturnType<typeof getDb>,
  eventId: string,
): Promise<boolean> {
  const prior = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.provider, 'avala'),
        sql`${webhookEvents.payload} ->> 'event_id' = ${eventId}`,
      ),
    )
    .limit(1)

  return prior.length > 0
}

async function recordWebhookEvent(tx: Transaction, event: AvalaWebhookEnvelope): Promise<void> {
  await tx.insert(webhookEvents).values({
    provider: 'avala',
    eventType: event.event_type ?? 'unknown',
    payload: event as unknown as Record<string, unknown>,
    processedAt: new Date(),
  })
}

function createAvalaContext(): PhyndServiceContext {
  return createServiceContext(getDb(), getCacheManager(), SERVICE_AUTH)
}

/** Writes the event's rows; returns the new-lead alert when a real lead was created. */
async function processAvalaEvent(
  ctx: PhyndServiceContext,
  event: AvalaWebhookEnvelope,
): Promise<LeadAlert | null> {
  const eventType = event.event_type ?? ''
  const payload = event.payload ?? {}

  switch (eventType) {
    case 'avala.lead.captured':
      return handleLeadCaptured(ctx, event, payload)
    case 'avala.visitor.page_viewed':
      await handleVisitorPageViewed(ctx, event, payload)
      break
    case 'avala.search.performed':
      await handleSearchPerformed(ctx, event, payload)
      break
    case 'avala.conversion.tracked':
      await handleConversionTracked(ctx, event, payload)
      break
    case 'avala.user.created':
    case 'avala.user.login':
      await handleUserLifecycle(ctx, event, payload)
      break
    case 'avala.tenant.created':
      await handleTenantCreated(ctx, event, payload)
      break
    case 'avala.subscription.created':
    case 'avala.subscription.updated':
    case 'avala.subscription.cancelled':
    case 'avala.payment.succeeded':
    case 'avala.payment.failed':
      await handleCustomerLifecycle(ctx, event, payload)
      break
    default:
      logger.info({ eventType }, 'Ignoring unknown Avala event type')
  }
  return null
}

async function handleLeadCaptured(
  ctx: PhyndServiceContext,
  event: AvalaWebhookEnvelope,
  payload: Record<string, unknown>,
): Promise<LeadAlert | null> {
  const lead = readObject(payload.lead)
  const attribution = readObject(payload.attribution)
  const email = readString(lead.email)
  if (!email) return null

  // A lead already stored for this Avala lead id (Avala re-emitting it under a
  // new event id) is not created again. Serialized per Avala lead id.
  const avalaLeadId = readString(lead.id)
  if (avalaLeadId) {
    await advisoryLock(ctx.db, `phynd:avala:lead:${avalaLeadId}`)
    const existing = await findLeadForAvalaLead(ctx, avalaLeadId)
    if (existing) {
      logger.info(
        { event_id: event.event_id, lead_id: existing },
        'Avala lead already stored for this Avala lead id; nothing created',
      )
      return null
    }
  }

  // `contacts.email` has no unique key: two first events for one new address
  // take turns here, and the second finds the contact the first created.
  await advisoryLock(ctx.db, `phynd:avala:email:${email.toLowerCase()}`)
  const name = readString(lead.name) ?? email.split('@')[0] ?? email
  const contact = await ensureContact(ctx, {
    email,
    name,
    phone: readString(lead.phone),
    company: readString(lead.company),
  })

  const source = readString(lead.source) ?? 'avala'
  const message = avalaLeadMessage(payload)
  const isTest = isTestLead({ source, email, name: readString(lead.name), message })
  const crmLead = await createDefaultLead(ctx, contact.id, source, {
    attribution: avalaLeadAttribution(payload),
    isTest,
  })

  // The prospect's own words, on the contact, so whoever calls reads them.
  if (message) {
    await new NotesService(ctx).create({
      content: avalaMessageNote(message),
      entityType: 'contact',
      entityId: contact.id,
    })
  }

  if (crmLead?.id) {
    await finishIntakeLead(ctx.db, logger, {
      leadId: crmLead.id,
      contactOwnerId: contact.ownerId,
      isTest,
      displayName: name,
      feed: 'avala',
    })
  }
  const visitorSession = await upsertVisitorSession(ctx, {
    externalSessionId: readString(attribution.sessionId),
    contactId: contact.id,
    identified: true,
    referrer: readString(attribution.sourcePage),
    utmSource: readString(attribution.utmSource),
    utmMedium: readString(attribution.utmMedium),
    utmCampaign: readString(attribution.utmCampaign),
    startedAt: readDate(event.occurred_at),
  })

  const conversionMetadata = {
    source: 'avala',
    event_id: event.event_id,
    avala_lead_id: avalaLeadId,
    ec_code: readString(lead.ecCode),
    certifier_id: readString(lead.certifierId),
    center_id: readString(lead.centerId),
    intent: readString(attribution.intent),
    availability_status: readString(attribution.availabilityStatus),
    interests: Array.isArray(lead.interests) ? lead.interests : [],
  }

  if (!crmLead?.id) {
    await new ConversionsService(ctx).recordConversion({
      type: 'visitor_to_lead',
      contactId: contact.id,
      visitorSessionId: visitorSession?.id,
      metadata: conversionMetadata,
    })
    return null
  }

  await ctx.db
    .update(conversions)
    .set({
      contactId: contact.id,
      visitorSessionId: visitorSession?.id,
      metadata: conversionMetadata,
    })
    .where(and(eq(conversions.type, 'visitor_to_lead'), eq(conversions.leadId, crmLead.id)))

  return {
    feed: 'avala',
    sourceLabel: source === 'avala' ? 'Avala' : `Avala · ${source}`,
    leadId: crmLead.id,
    contactId: contact.id,
    tier: await leadTierOf(ctx, crmLead.id),
    isTest,
  }
}

/**
 * The CRM lead an earlier event already created for this Avala lead id: its
 * `visitor_to_lead` conversion carries `metadata.avala_lead_id`.
 */
async function findLeadForAvalaLead(
  ctx: PhyndServiceContext,
  avalaLeadId: string,
): Promise<string | null> {
  const [row] = await ctx.db
    .select({ leadId: conversions.leadId })
    .from(conversions)
    .where(
      and(
        eq(conversions.type, 'visitor_to_lead'),
        isNotNull(conversions.leadId),
        sql`${conversions.metadata} ->> 'avala_lead_id' = ${avalaLeadId}`,
      ),
    )
    .limit(1)
  return row?.leadId ?? null
}

async function handleVisitorPageViewed(
  ctx: PhyndServiceContext,
  event: AvalaWebhookEnvelope,
  payload: Record<string, unknown>,
): Promise<void> {
  const session = await upsertVisitorSession(ctx, {
    externalSessionId: readString(payload.sessionId),
    referrer: readString(payload.referrer),
    startedAt: readDate(event.occurred_at),
  })

  if (!session) return

  const service = new VisitorTrackingService(ctx)
  await service.recordPageView({
    sessionId: session.id,
    url: normalizeUrl(readString(payload.url)),
    title: readString(payload.title) ?? event.event_type,
    viewedAt: readDate(event.occurred_at),
  })
}

async function handleSearchPerformed(
  ctx: PhyndServiceContext,
  event: AvalaWebhookEnvelope,
  payload: Record<string, unknown>,
): Promise<void> {
  const session = await upsertVisitorSession(ctx, {
    externalSessionId: readString(payload.sessionId),
    startedAt: readDate(event.occurred_at),
  })

  if (!session) return

  const service = new VisitorTrackingService(ctx)
  const query = readString(payload.query) ?? ''
  const searchType = readString(payload.searchType) ?? 'GENERAL'
  await service.recordPageView({
    sessionId: session.id,
    url: `https://avala.studio/explorar?searchType=${encodeURIComponent(searchType)}&q=${encodeURIComponent(query)}`,
    title: `Avala search: ${searchType}`,
    viewedAt: readDate(event.occurred_at),
  })
}

async function handleConversionTracked(
  ctx: PhyndServiceContext,
  event: AvalaWebhookEnvelope,
  payload: Record<string, unknown>,
): Promise<void> {
  const conversionsService = new ConversionsService(ctx)
  await conversionsService.recordConversion({
    type: 'avala_conversion',
    metadata: {
      source: 'avala',
      event_id: event.event_id,
      event_name: readString(payload.eventName),
      source_page: readString(payload.sourcePage),
      intent: readString(payload.intent),
      session_id: readString(payload.sessionId),
      avala_metadata: readObject(payload.metadata),
    },
  })
}

async function handleUserLifecycle(
  ctx: PhyndServiceContext,
  event: AvalaWebhookEnvelope,
  payload: Record<string, unknown>,
): Promise<void> {
  const user = readObject(payload.user)
  const email = readString(user.email)
  if (!email) return

  await ensureContact(ctx, {
    email,
    name:
      [readString(user.firstName), readString(user.lastName)].filter(Boolean).join(' ') || email,
    externalJanuaId: readString(user.januaSubjectId),
  })

  const conversionsService = new ConversionsService(ctx)
  await conversionsService.recordConversion({
    type: 'avala_user_lifecycle',
    metadata: {
      source: 'avala',
      event_id: event.event_id,
      event_type: event.event_type,
      tenant_id: readString(payload.tenantId),
      avala_user_id: readString(user.id),
      role: readString(user.role),
    },
  })
}

async function handleTenantCreated(
  ctx: PhyndServiceContext,
  event: AvalaWebhookEnvelope,
  payload: Record<string, unknown>,
): Promise<void> {
  const tenant = readObject(payload.tenant)
  const admin = readObject(payload.admin)
  const email = readString(admin.email)

  if (email) {
    await ensureContact(ctx, {
      email,
      name:
        [readString(admin.firstName), readString(admin.lastName)].filter(Boolean).join(' ') ||
        email,
      company: readString(tenant.name),
    })
  }

  const conversionsService = new ConversionsService(ctx)
  await conversionsService.recordConversion({
    type: 'avala_tenant_created',
    metadata: {
      source: 'avala',
      event_id: event.event_id,
      tenant,
      admin_email: email,
    },
  })
}

async function handleCustomerLifecycle(
  ctx: PhyndServiceContext,
  event: AvalaWebhookEnvelope,
  payload: Record<string, unknown>,
): Promise<void> {
  const conversionsService = new ConversionsService(ctx)
  const eventType = event.event_type ?? ''
  await conversionsService.recordConversion({
    type: eventType.replace(/^avala\./, 'avala_').replace(/\./g, '_'),
    value: valueFromPaymentPayload(payload),
    metadata: {
      source: 'avala',
      event_id: event.event_id,
      event_type: eventType,
      tenant_id: readString(payload.tenantId),
      janua_customer_id: readString(payload.januaCustomerId),
      plan: readString(payload.plan),
      status: readString(payload.status),
      provider: readString(payload.provider),
      currency: readString(payload.currency),
      raw_event_type: readString(payload.rawEventType),
    },
  })
}

async function ensureContact(
  ctx: PhyndServiceContext,
  data: {
    email: string
    name: string
    phone?: string
    company?: string
    externalJanuaId?: string
  },
) {
  const contactsService = new ContactsService(ctx)
  const existing = await contactsService.getByEmail(data.email)
  if (existing) {
    if (data.externalJanuaId && !existing.externalJanuaId) {
      await ctx.db
        .update(contacts)
        .set({ externalJanuaId: data.externalJanuaId })
        .where(eq(contacts.id, existing.id))
      return { ...existing, externalJanuaId: data.externalJanuaId }
    }

    return existing
  }

  return contactsService.create({
    name: data.name,
    email: data.email,
    phone: data.phone,
    company: data.company,
    ...(data.externalJanuaId ? { externalJanuaId: data.externalJanuaId } : {}),
  })
}

async function createDefaultLead(
  ctx: PhyndServiceContext,
  contactId: string,
  source: string,
  extra: { attribution: LeadAttribution | null; isTest: boolean },
) {
  const leadsService = new LeadsService(ctx)
  const pipelinesService = new PipelinesService(ctx)
  const pipeline = await pipelinesService.getDefault()
  if (!pipeline) return null

  const stages = await pipelinesService.getStages(pipeline.id)
  const firstStage = stages[0]
  if (!firstStage) return null

  return leadsService.create({
    contactId,
    // `leads.source` is varchar(100).
    source: source.slice(0, 100),
    attribution: extra.attribution,
    isTest: extra.isTest,
    pipelineId: pipeline.id,
    stageId: firstStage.id,
  })
}

async function upsertVisitorSession(
  ctx: PhyndServiceContext,
  data: {
    externalSessionId?: string
    contactId?: string
    identified?: boolean
    referrer?: string
    utmSource?: string
    utmMedium?: string
    utmCampaign?: string
    startedAt: Date
  },
) {
  const externalSessionId = data.externalSessionId
  if (!externalSessionId) return null

  const service = new VisitorTrackingService(ctx)
  return service.upsertFromWebhook({
    externalSessionId,
    contactId: data.contactId,
    identified: data.identified,
    referrer: data.referrer,
    utmSource: data.utmSource,
    utmMedium: data.utmMedium,
    utmCampaign: data.utmCampaign,
    startedAt: data.startedAt,
    pageViewCount: 1,
  })
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readDate(value: unknown): Date {
  const raw = readString(value)
  const date = raw ? new Date(raw) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function normalizeUrl(value: string | undefined): string {
  if (!value) return 'https://avala.studio/'
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  if (value.startsWith('/')) return `https://avala.studio${value}`
  return `https://avala.studio/${value}`
}

function valueFromPaymentPayload(payload: Record<string, unknown>): string | undefined {
  const amount = payload.amount
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    return String(amount / 100)
  }
  if (typeof amount === 'string' && amount.trim()) {
    return amount
  }
  return undefined
}

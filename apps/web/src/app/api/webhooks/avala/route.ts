import { getCacheManager } from '@/lib/federation/clients'
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
  PipelinesService,
  VisitorTrackingService,
  createServiceContext,
} from '@phynd/services'
import type { AuthContext } from '@phynd/types/auth'
import { and, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('web:webhook:avala')

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

  if (await hasSeenEvent(eventId)) {
    return NextResponse.json(
      { received: true, status: 'duplicate', event_id: eventId },
      { headers: { 'X-RateLimit-Remaining': String(remaining) } },
    )
  }

  try {
    await processAvalaEvent(event)
    await recordWebhookEvent(event)

    return NextResponse.json(
      { received: true, status: 'processed', event_id: eventId, event_type: eventType },
      { headers: { 'X-RateLimit-Remaining': String(remaining) } },
    )
  } catch (err) {
    logger.error(
      { err, event_id: eventId, event_type: eventType },
      'Avala webhook processing failed',
    )
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
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

async function hasSeenEvent(eventId: string): Promise<boolean> {
  const db = getDb()
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

async function recordWebhookEvent(event: AvalaWebhookEnvelope): Promise<void> {
  await getDb()
    .insert(webhookEvents)
    .values({
      provider: 'avala',
      eventType: event.event_type ?? 'unknown',
      payload: event as unknown as Record<string, unknown>,
      processedAt: new Date(),
    })
}

function createAvalaContext(): PhyndServiceContext {
  return createServiceContext(getDb(), getCacheManager(), SERVICE_AUTH)
}

async function processAvalaEvent(event: AvalaWebhookEnvelope): Promise<void> {
  const ctx = createAvalaContext()
  const eventType = event.event_type ?? ''
  const payload = event.payload ?? {}

  switch (eventType) {
    case 'avala.lead.captured':
      await handleLeadCaptured(ctx, event, payload)
      return
    case 'avala.visitor.page_viewed':
      await handleVisitorPageViewed(ctx, event, payload)
      return
    case 'avala.search.performed':
      await handleSearchPerformed(ctx, event, payload)
      return
    case 'avala.conversion.tracked':
      await handleConversionTracked(ctx, event, payload)
      return
    case 'avala.user.created':
    case 'avala.user.login':
      await handleUserLifecycle(ctx, event, payload)
      return
    case 'avala.tenant.created':
      await handleTenantCreated(ctx, event, payload)
      return
    case 'avala.subscription.created':
    case 'avala.subscription.updated':
    case 'avala.subscription.cancelled':
    case 'avala.payment.succeeded':
    case 'avala.payment.failed':
      await handleCustomerLifecycle(ctx, event, payload)
      return
    default:
      logger.info({ eventType }, 'Ignoring unknown Avala event type')
  }
}

async function handleLeadCaptured(
  ctx: PhyndServiceContext,
  event: AvalaWebhookEnvelope,
  payload: Record<string, unknown>,
): Promise<void> {
  const lead = readObject(payload.lead)
  const attribution = readObject(payload.attribution)
  const email = readString(lead.email)
  if (!email) return

  const contact = await ensureContact(ctx, {
    email,
    name: readString(lead.name) ?? email.split('@')[0] ?? email,
    phone: readString(lead.phone),
    company: readString(lead.company),
  })

  const crmLead = await createDefaultLead(ctx, contact.id, readString(lead.source) ?? 'avala')
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
    avala_lead_id: readString(lead.id),
    ec_code: readString(lead.ecCode),
    intent: readString(attribution.intent),
    availability_status: readString(attribution.availabilityStatus),
    interests: Array.isArray(lead.interests) ? lead.interests : [],
  }

  if (crmLead?.id) {
    await ctx.db
      .update(conversions)
      .set({
        contactId: contact.id,
        visitorSessionId: visitorSession?.id,
        metadata: conversionMetadata,
      })
      .where(and(eq(conversions.type, 'visitor_to_lead'), eq(conversions.leadId, crmLead.id)))
    return
  }

  const conversionsService = new ConversionsService(ctx)
  await conversionsService.recordConversion({
    type: 'visitor_to_lead',
    contactId: contact.id,
    visitorSessionId: visitorSession?.id,
    metadata: conversionMetadata,
  })
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
      await getDb()
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

async function createDefaultLead(ctx: PhyndServiceContext, contactId: string, source: string) {
  const leadsService = new LeadsService(ctx)
  const pipelinesService = new PipelinesService(ctx)
  const pipeline = await pipelinesService.getDefault()
  if (!pipeline) return null

  const stages = await pipelinesService.getStages(pipeline.id)
  const firstStage = stages[0]
  if (!firstStage) return null

  return leadsService.create({
    contactId,
    source,
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

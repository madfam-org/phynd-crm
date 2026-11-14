import { getCacheManager } from '@/lib/federation/clients'
import { checkRateLimit } from '@/lib/webhooks/rate-limiter'
import { resolveRedisUrl } from '@phynd/config/connections'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { contacts, leads, notes, pipelineStages, pipelines, webhookEvents } from '@phynd/db/schema'
import { validateWebhookSignature } from '@phynd/federation/webhooks'
import { createLogger } from '@phynd/logging'
import { GrantsService, PipelinesService, createServiceContext } from '@phynd/services'
import { Queue } from 'bullmq'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('web:webhook:fortuna')

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000 // 5 minutes

interface FortunaGrantPayload {
  type: 'grant.discovered'
  data: {
    fortuna_grant_id: string
    title: string
    granting_body?: string
    category?: string
    funding_type?: string
    min_amount?: string
    max_amount?: string
    currency?: string
    source_url?: string
    closes_at?: string
    relevance_score?: string
    requirements_summary?: string
    metadata?: Record<string, unknown>
  }
}

interface FortunaDecisionMaker {
  name?: unknown
  role?: unknown
  source_url?: unknown
  profile_urls?: unknown
}

/**
 * Envelope sent by Fortuna's prospect dispatcher
 * (services/jobs/jobs/prospect/dispatcher.py): the event name travels in
 * `event` and the dedup key in `idempotency_key` (= `data.prospect_id`).
 * `type` is accepted too so the envelope matches the grant event's shape.
 */
interface FortunaProspectPayload {
  type?: string
  event?: string
  idempotency_key?: unknown
  timestamp?: unknown
  data?: {
    prospect_id?: unknown
    tenant_id?: unknown
    domain?: unknown
    business_name?: unknown
    tmm_score?: unknown
    confidence?: unknown
    decision_makers?: unknown
    evidence?: unknown
  }
}

type FortunaPayload = FortunaGrantPayload | FortunaProspectPayload

const PROSPECT_EVENT = 'prospect.qualified'
const PROSPECT_LEAD_SOURCE = 'fortuna'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NOTE_VALUE_MAX_LENGTH = 300

async function checkWebhookRateLimit(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { allowed, remaining } = await checkRateLimit(ip)

  if (!allowed) {
    return {
      remaining,
      response: NextResponse.json(
        { error: 'Rate limit exceeded' },
        {
          status: 429,
          headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' },
        },
      ),
    }
  }

  return { remaining, response: null }
}

function validateTimestamp(req: Request): NextResponse | null {
  const timestamp = req.headers.get('x-webhook-timestamp')
  if (!timestamp) return null

  const age = Date.now() - new Date(timestamp).getTime()
  if (Number.isNaN(age) || age > MAX_TIMESTAMP_AGE_MS) {
    return NextResponse.json({ error: 'Webhook timestamp expired' }, { status: 401 })
  }

  return null
}

function validateSignature(req: Request, body: string, secret: string): NextResponse | null {
  const signature = req.headers.get('x-fortuna-signature') ?? ''
  if (!validateWebhookSignature(body, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  return null
}

function createFortunaServiceContext() {
  const db = getDb()
  const cache = getCacheManager()
  const botAuth = {
    userId: 'system:fortuna-webhook',
    tenantId: DEFAULT_TENANT_ID,
    roles: ['admin'],
    scopes: ['*'],
    accessToken: 'internal:fortuna-webhook',
  }

  return {
    ctx: createServiceContext(db, cache, botAuth),
    db,
  }
}

async function resolveTreasuryStage(db: ReturnType<typeof getDb>) {
  const [treasuryPipeline] = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.name, 'Treasury Hunter'))

  if (!treasuryPipeline) {
    logger.error('Treasury Hunter pipeline not found — cannot create application')
    return { error: NextResponse.json({ error: 'Pipeline not configured' }, { status: 500 }) }
  }

  const stages = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, treasuryPipeline.id))

  type StageRow = (typeof stages)[number]
  const discoveredStage = stages.find((s: StageRow) => s.name === 'Discovered')
  if (!discoveredStage) {
    logger.error('Discovered stage not found in Treasury Hunter pipeline')
    return { error: NextResponse.json({ error: 'Stage not configured' }, { status: 500 }) }
  }

  return { discoveredStage, treasuryPipeline }
}

async function enqueueComplianceCheck(
  applicationId: string,
  opportunityId: string,
  fortunaGrantId: string,
) {
  try {
    const redisUrl = resolveRedisUrl()
    const url = new URL(redisUrl)
    const connection = {
      host: url.hostname,
      port: Number(url.port) || 6379,
      password: url.password || undefined,
    }
    const queue = new Queue('grant-compliance-check', { connection })
    await queue.add('check', {
      grantApplicationId: applicationId,
      grantOpportunityId: opportunityId,
      fortunaGrantId,
    })
    await queue.close()
  } catch (err) {
    // Non-blocking: compliance check enqueue failure should not break webhook processing
    logger.error({ err }, 'Failed to enqueue grant-compliance-check job')
  }
}

async function processGrantDiscovered(payload: FortunaGrantPayload, remaining: number) {
  const grantData = payload.data
  if (!grantData?.fortuna_grant_id || !grantData?.title) {
    logger.warn({ payload }, 'Malformed grant.discovered payload — skipping')
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
  }

  const { ctx, db } = createFortunaServiceContext()
  const grantsService = new GrantsService(ctx)

  // Upsert the grant opportunity (idempotent by fortunaGrantId)
  const opportunity = await grantsService.upsertOpportunity({
    fortunaGrantId: grantData.fortuna_grant_id,
    title: grantData.title,
    grantingBody: grantData.granting_body,
    category: grantData.category,
    fundingType: grantData.funding_type,
    minAmount: grantData.min_amount,
    maxAmount: grantData.max_amount,
    currency: grantData.currency,
    sourceUrl: grantData.source_url,
    closesAt: grantData.closes_at ? new Date(grantData.closes_at) : undefined,
    relevanceScore: grantData.relevance_score,
    requirementsSummary: grantData.requirements_summary,
    metadata: grantData.metadata,
  })

  const stageConfig = await resolveTreasuryStage(db)
  if ('error' in stageConfig) return stageConfig.error

  const application = await grantsService.createApplication({
    grantOpportunityId: opportunity.id,
    pipelineId: stageConfig.treasuryPipeline.id,
    stageId: stageConfig.discoveredStage.id,
    requestedAmount: grantData.max_amount,
  })

  await enqueueComplianceCheck(application.id, opportunity.id, grantData.fortuna_grant_id)

  logger.info(
    {
      opportunityId: opportunity.id,
      applicationId: application.id,
      fortunaGrantId: grantData.fortuna_grant_id,
    },
    'Grant discovered — opportunity and application created',
  )

  return NextResponse.json(
    { received: true, opportunityId: opportunity.id, applicationId: application.id },
    { headers: { 'X-RateLimit-Remaining': String(remaining) } },
  )
}

function readString(value: unknown, maxLength = 255): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed.slice(0, maxLength)
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function formatNoteValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > NOTE_VALUE_MAX_LENGTH ? `${text.slice(0, NOTE_VALUE_MAX_LENGTH)}…` : text
}

function readDecisionMakers(value: unknown): FortunaDecisionMaker[] {
  return Array.isArray(value)
    ? value.filter((item): item is FortunaDecisionMaker => !!item && typeof item === 'object')
    : []
}

/** First well-formed address in the `contact_emails` evidence fact, lowercased. */
function readEvidenceEmail(evidence: Record<string, unknown>): string | undefined {
  const fact = readRecord(evidence.contact_emails)
  const values = Array.isArray(fact.value) ? fact.value : []
  for (const candidate of values) {
    const email = readString(candidate)?.toLowerCase()
    if (email && EMAIL_PATTERN.test(email)) return email
  }
  return undefined
}

function buildProspectNote(input: {
  prospectId: string
  domain?: string
  businessName?: string
  score: unknown
  confidence: unknown
  decisionMakers: FortunaDecisionMaker[]
  evidence: Record<string, unknown>
}): string {
  const lines = [
    'Prospecto calificado por Fortuna. Sin consentimiento de contacto registrado:',
    'no enviar comunicaciones ni inscribir en campañas hasta obtenerlo.',
    '',
    `Puntaje TMM: ${formatNoteValue(input.score)} · Confianza: ${formatNoteValue(input.confidence)}`,
    `Negocio: ${input.businessName ?? '—'} · Dominio: ${input.domain ?? '—'}`,
    `ID de prospecto en Fortuna: ${input.prospectId}`,
  ]

  if (input.decisionMakers.length > 0) {
    lines.push('', 'Personas identificadas:')
    for (const person of input.decisionMakers) {
      const name = readString(person.name) ?? '—'
      const role = readString(person.role)
      const profiles = Array.isArray(person.profile_urls)
        ? person.profile_urls.filter((url): url is string => typeof url === 'string')
        : []
      lines.push(
        `- ${name}${role ? ` (${role})` : ''}${profiles.length > 0 ? ` — ${profiles.join(', ')}` : ''}`,
      )
    }
  }

  const facts = Object.entries(input.evidence)
  if (facts.length > 0) {
    lines.push('', 'Señales y evidencia:')
    for (const [fact, raw] of facts) {
      const entry = readRecord(raw)
      const hasValue = 'value' in entry
      const value = formatNoteValue(hasValue ? entry.value : raw)
      const source = readString(entry.source_url, 2048)
      const collectedAt = readString(entry.collected_at)
      const provenance = [source, collectedAt].filter(Boolean).join(' · ')
      lines.push(`- ${fact}: ${value}${provenance ? ` (${provenance})` : ''}`)
    }
  }

  return lines.join('\n')
}

async function resolveDefaultLeadStage(ctx: ReturnType<typeof createServiceContext>) {
  const pipelinesService = new PipelinesService(ctx)
  const pipeline = await pipelinesService.getDefault()
  if (!pipeline) return null
  const [firstStage] = await pipelinesService.getStages(pipeline.id)
  if (!firstStage) return null
  return { pipelineId: pipeline.id, stageId: firstStage.id }
}

/**
 * A prospect qualified (and dispatched by a human operator) in Fortuna becomes
 * a contact + lead + note for staff to review. These are cold prospects with
 * no consent on record: nothing here sends, enqueues or enrolls anything, the
 * contact keeps `marketingConsent = false`, and the lead is created with
 * `unsubscribed = true` so no campaign or drip can select it until a human
 * records consent. Contact rows that already exist are never overwritten.
 */
async function processProspectQualified(payload: FortunaProspectPayload, remaining: number) {
  const data = readRecord(payload.data)
  const prospectId = readString(data.prospect_id)
  const idempotencyKey = readString(payload.idempotency_key) ?? prospectId
  const domain = readString(data.domain)
  const businessName = readString(data.business_name)

  if (!prospectId || !idempotencyKey || (!domain && !businessName)) {
    logger.warn(
      { hasProspectId: !!prospectId, hasDomain: !!domain, hasBusinessName: !!businessName },
      'Malformed prospect.qualified payload — skipping',
    )
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
  }

  const { ctx, db } = createFortunaServiceContext()

  const [prior] = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.provider, 'fortuna'),
        sql`${webhookEvents.payload} ->> 'idempotency_key' = ${idempotencyKey}`,
      ),
    )
    .limit(1)
  if (prior) {
    return NextResponse.json(
      { received: true, deduplicated: true },
      { headers: { 'X-RateLimit-Remaining': String(remaining) } },
    )
  }

  const stage = await resolveDefaultLeadStage(ctx)
  if (!stage) {
    logger.error('Default pipeline or its first stage not found — cannot create prospect lead')
    return NextResponse.json({ error: 'Pipeline not configured' }, { status: 500 })
  }

  const evidence = readRecord(data.evidence)
  const decisionMakers = readDecisionMakers(data.decision_makers)
  const email = readEvidenceEmail(evidence)
  const company = businessName ?? domain
  const contactName =
    decisionMakers.map((person) => readString(person.name)).find(Boolean) ?? company ?? prospectId

  const result = await db.transaction(async (tx) => {
    const [existing] = email
      ? await tx
          .select()
          .from(contacts)
          .where(and(eq(contacts.email, email), isNull(contacts.deletedAt)))
          .limit(1)
      : []

    let contactId: string
    if (existing) {
      contactId = existing.id
      // Fill a blank company only; every value already on the contact stays.
      if (!existing.company && company) {
        await tx.update(contacts).set({ company }).where(eq(contacts.id, existing.id))
      }
    } else {
      const [created] = await tx
        .insert(contacts)
        .values({
          name: contactName,
          email,
          company,
          marketingConsent: false,
          consentedAt: null,
        })
        .returning({ id: contacts.id })
      // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
      contactId = created!.id
    }

    const [lead] = await tx
      .insert(leads)
      .values({
        contactId,
        source: PROSPECT_LEAD_SOURCE,
        pipelineId: stage.pipelineId,
        stageId: stage.stageId,
        unsubscribed: true,
      })
      .returning({ id: leads.id })
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    const leadId = lead!.id

    await tx.insert(notes).values({
      content: buildProspectNote({
        prospectId,
        domain,
        businessName,
        score: data.tmm_score,
        confidence: data.confidence,
        decisionMakers,
        evidence,
      }),
      entityType: 'lead',
      entityId: leadId,
      authorId: ctx.auth.userId,
    })

    await tx.insert(webhookEvents).values({
      provider: 'fortuna',
      eventType: PROSPECT_EVENT,
      payload: { ...payload, idempotency_key: idempotencyKey } as Record<string, unknown>,
      processedAt: new Date(),
    })

    return { contactId, leadId, contactReused: !!existing }
  })

  logger.info(
    { ...result, prospectId },
    'Prospect qualified — contact, lead and note recorded for review',
  )

  return NextResponse.json(
    { received: true, ...result },
    { headers: { 'X-RateLimit-Remaining': String(remaining) } },
  )
}

async function processFortunaPayload(body: string, remaining: number) {
  const payload = JSON.parse(body) as FortunaPayload
  const prospectPayload = payload as FortunaProspectPayload
  const eventType = prospectPayload.type ?? prospectPayload.event

  if (eventType === PROSPECT_EVENT) {
    return processProspectQualified(prospectPayload, remaining)
  }

  if (payload.type !== 'grant.discovered') {
    logger.info({ eventType }, 'Ignoring unhandled Fortuna event')
    return NextResponse.json(
      { received: true },
      { headers: { 'X-RateLimit-Remaining': String(remaining) } },
    )
  }

  return processGrantDiscovered(payload as FortunaGrantPayload, remaining)
}

export async function POST(req: Request) {
  const secret = process.env.FORTUNA_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  const { remaining, response } = await checkWebhookRateLimit(req)
  if (response) return response

  const timestampError = validateTimestamp(req)
  if (timestampError) return timestampError

  // Signature validation — Fortuna uses X-Fortuna-Signature instead of X-Webhook-Signature
  const body = await req.text()
  const signatureError = validateSignature(req, body, secret)
  if (signatureError) return signatureError

  try {
    return await processFortunaPayload(body, remaining)
  } catch (error) {
    logger.error({ err: error }, 'Fortuna webhook processing error')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}

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
// Scraped pages yield asset names shaped like addresses (`logo@2x.webp`).
const ASSET_DOMAIN_PATTERN = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js)$/i
// `contacts.name` / `contacts.email` / `contacts.company` are varchar(255).
const COLUMN_MAX_LENGTH = 255
const NOTE_VALUE_MAX_LENGTH = 300
const NOTE_URL_MAX_LENGTH = 500
const NOTE_MAX_LENGTH = 8000
const NOTE_MAX_EVIDENCE_FACTS = 30
const NOTE_MAX_DECISION_MAKERS = 10
const NOTE_MAX_PROFILE_URLS = 5
const NOTE_TENANT_MAX_LENGTH = 100
const EMAIL_CANDIDATES_MAX = 20

/** Largest body read from the sender; anything bigger is rejected with 413. */
const MAX_BODY_BYTES = 256 * 1024
/** Window for the signed `timestamp` inside a prospect envelope. */
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_EVENT_FUTURE_SKEW_MS = 10 * 60 * 1000

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

/**
 * Fortuna signs with the same scheme under two header names: the grant
 * dispatcher sends `X-Fortuna-Signature`, the prospect dispatcher sends
 * `X-Madfam-Fortuna-Signature`. Both are HMAC-SHA256 over the raw body, with
 * an optional `sha256=` prefix. Whichever is present is checked against the
 * one secret; an absent or empty header fails validation.
 */
const SIGNATURE_HEADERS = ['x-madfam-fortuna-signature', 'x-fortuna-signature'] as const

function readSignature(req: Request): string {
  for (const name of SIGNATURE_HEADERS) {
    const value = req.headers.get(name)
    if (value) return value
  }
  return ''
}

function validateSignature(req: Request, body: string, secret: string): NextResponse | null {
  const signature = readSignature(req)
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

function readString(value: unknown, maxLength = COLUMN_MAX_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed.slice(0, maxLength)
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function formatNoteValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return truncate(text ?? '—', NOTE_VALUE_MAX_LENGTH)
}

function readDecisionMakers(value: unknown): FortunaDecisionMaker[] {
  return Array.isArray(value)
    ? value.filter((item): item is FortunaDecisionMaker => !!item && typeof item === 'object')
    : []
}

/** A well-formed address that is not an asset file name, lowercased; else undefined. */
function usableProspectEmail(candidate: unknown): string | undefined {
  const email = readString(candidate, Number.POSITIVE_INFINITY)?.toLowerCase()
  if (!email || email.length > COLUMN_MAX_LENGTH || !EMAIL_PATTERN.test(email)) return undefined
  const domain = email.slice(email.lastIndexOf('@') + 1)
  return ASSET_DOMAIN_PATTERN.test(domain) ? undefined : email
}

/** First usable address in the `contact_emails` evidence fact. */
function readEvidenceEmail(evidence: Record<string, unknown>): string | undefined {
  const fact = readRecord(evidence.contact_emails)
  const values = Array.isArray(fact.value) ? fact.value.slice(0, EMAIL_CANDIDATES_MAX) : []
  for (const candidate of values) {
    const email = usableProspectEmail(candidate)
    if (email) return email
  }
  return undefined
}

interface ProspectNoteInput {
  prospectId: string
  tenantId: unknown
  domain?: string
  businessName?: string
  score: unknown
  confidence: unknown
  decisionMakers: FortunaDecisionMaker[]
  evidence: Record<string, unknown>
}

function omittedLine(count: number, what: string): string[] {
  return count > 0 ? [`- … (${count} ${what} más omitidas)`] : []
}

function noteHeaderLines(input: ProspectNoteInput): string[] {
  const tenant = input.tenantId === undefined ? '—' : formatNoteValue(input.tenantId)
  return [
    'Prospecto calificado por Fortuna. Sin consentimiento de contacto registrado:',
    'no enviar comunicaciones ni inscribir en campañas hasta obtenerlo.',
    '',
    `Puntaje TMM: ${formatNoteValue(input.score)} · Confianza: ${formatNoteValue(input.confidence)}`,
    `Negocio: ${input.businessName ?? '—'} · Dominio: ${input.domain ?? '—'}`,
    `ID de prospecto en Fortuna: ${input.prospectId}`,
    `Tenant de origen en Fortuna: ${truncate(tenant, NOTE_TENANT_MAX_LENGTH)}`,
  ]
}

function readProfileUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((url): url is string => typeof url === 'string')
    .slice(0, NOTE_MAX_PROFILE_URLS)
    .map((url) => truncate(url, NOTE_URL_MAX_LENGTH))
}

function decisionMakerLine(person: FortunaDecisionMaker): string {
  const label = readString(person.name) ?? '—'
  const role = readString(person.role)
  const profiles = readProfileUrls(person.profile_urls)
  const roleText = role ? ` (${role})` : ''
  const profileText = profiles.length > 0 ? ` — ${profiles.join(', ')}` : ''
  return `- ${label}${roleText}${profileText}`
}

/**
 * The sender derives `name` from a social-profile URL, so it is a link label,
 * not a verified person: it stays in the note and never names a contact.
 */
function decisionMakerLines(people: FortunaDecisionMaker[]): string[] {
  if (people.length === 0) return []
  const shown = people.slice(0, NOTE_MAX_DECISION_MAKERS)
  return [
    '',
    'Perfiles enlazados (etiqueta derivada del enlace, no verificada):',
    ...shown.map(decisionMakerLine),
    ...omittedLine(people.length - shown.length, 'entradas'),
  ]
}

function evidenceLine(fact: string, raw: unknown): string {
  const entry = readRecord(raw)
  const value = formatNoteValue('value' in entry ? entry.value : raw)
  const source = readString(entry.source_url, Number.POSITIVE_INFINITY)
  const collectedAt = readString(entry.collected_at)
  const provenance = [source && truncate(source, NOTE_URL_MAX_LENGTH), collectedAt]
    .filter(Boolean)
    .join(' · ')
  return `- ${truncate(fact, 100)}: ${value}${provenance ? ` (${provenance})` : ''}`
}

function evidenceLines(evidence: Record<string, unknown>): string[] {
  const facts = Object.entries(evidence)
  if (facts.length === 0) return []
  const shown = facts.slice(0, NOTE_MAX_EVIDENCE_FACTS)
  return [
    '',
    'Señales y evidencia:',
    ...shown.map(([fact, raw]) => evidenceLine(fact, raw)),
    ...omittedLine(facts.length - shown.length, 'señales'),
  ]
}

function buildProspectNote(input: ProspectNoteInput): string {
  const note = [
    ...noteHeaderLines(input),
    ...decisionMakerLines(input.decisionMakers),
    ...evidenceLines(input.evidence),
  ].join('\n')
  const marker = '\n… [nota truncada]'
  return note.length > NOTE_MAX_LENGTH
    ? `${note.slice(0, NOTE_MAX_LENGTH - marker.length)}${marker}`
    : note
}

async function resolveDefaultLeadStage(ctx: ReturnType<typeof createServiceContext>) {
  const pipelinesService = new PipelinesService(ctx)
  const pipeline = await pipelinesService.getDefault()
  if (!pipeline) return null
  const [firstStage] = await pipelinesService.getStages(pipeline.id)
  if (!firstStage) return null
  return { pipelineId: pipeline.id, stageId: firstStage.id }
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

/** Transaction-scoped advisory lock, released at commit or rollback. */
async function lockKey(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
}

/**
 * The signed body `timestamp`, when present, must fall inside the window.
 * The sender sends no timestamp header, so without this a captured request
 * could be replayed whenever its dedup row is gone.
 */
function eventTimestampError(timestamp: unknown): NextResponse | null {
  if (timestamp === undefined || timestamp === null) return null
  const sentAt = typeof timestamp === 'string' ? new Date(timestamp).getTime() : Number.NaN
  const age = Date.now() - sentAt
  if (Number.isNaN(age) || age > MAX_EVENT_AGE_MS || -age > MAX_EVENT_FUTURE_SKEW_MS) {
    return NextResponse.json({ error: 'Event timestamp outside accepted window' }, { status: 401 })
  }
  return null
}

interface ParsedProspect {
  prospectId: string
  idempotencyKey: string
  domain?: string
  businessName?: string
  email?: string
  noteInput: ProspectNoteInput
}

function parseProspect(payload: FortunaProspectPayload): ParsedProspect | null {
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
    return null
  }

  const evidence = readRecord(data.evidence)
  return {
    prospectId,
    idempotencyKey,
    domain,
    businessName,
    email: readEvidenceEmail(evidence),
    noteInput: {
      prospectId,
      tenantId: data.tenant_id,
      domain,
      businessName,
      score: data.tmm_score,
      confidence: data.confidence,
      decisionMakers: readDecisionMakers(data.decision_makers),
      evidence,
    },
  }
}

type ProspectOutcome =
  | { deduplicated: true }
  | { contactId: string; leadId: string | null; matchedExistingContact: boolean }

async function recordProspect(
  tx: Tx,
  prospect: ParsedProspect,
  stage: { pipelineId: string; stageId: string },
  payload: FortunaProspectPayload,
  authorId: string,
): Promise<ProspectOutcome> {
  // One consistent lock order: the event first, then the email.
  await lockKey(tx, `phynd:fortuna:event:${prospect.idempotencyKey}`)
  const [prior] = await tx
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.provider, 'fortuna'),
        sql`${webhookEvents.payload} ->> 'idempotency_key' = ${prospect.idempotencyKey}`,
      ),
    )
    .limit(1)
  if (prior) return { deduplicated: true }

  const { email } = prospect
  let existingId: string | undefined
  if (email) {
    // Same key as the billing webhook's buyer lookup, so the two never race.
    await lockKey(tx, `phynd:buyer:email:${email}`)
    const [existing] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(sql`lower(${contacts.email}) = ${email}`, isNull(contacts.deletedAt)))
      .limit(1)
    existingId = existing?.id
  }

  const content = buildProspectNote(prospect.noteInput)
  let outcome: ProspectOutcome
  if (existingId) {
    // An existing contact (possibly an opted-in customer, or a third party
    // whose address is on the prospect's site) is never touched: no lead,
    // since an unsubscribed lead would block every campaign to it, and no
    // field update. Staff get the note on the contact to review.
    await tx
      .insert(notes)
      .values({ content, entityType: 'contact', entityId: existingId, authorId })
    outcome = { contactId: existingId, leadId: null, matchedExistingContact: true }
  } else {
    const company = prospect.businessName ?? prospect.domain
    const [created] = await tx
      .insert(contacts)
      .values({
        name: company ?? prospect.prospectId,
        email,
        company,
        marketingConsent: false,
        consentedAt: null,
      })
      .returning({ id: contacts.id })
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    const contactId = created!.id

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

    await tx.insert(notes).values({ content, entityType: 'lead', entityId: leadId, authorId })
    outcome = { contactId, leadId, matchedExistingContact: false }
  }

  await tx.insert(webhookEvents).values({
    provider: 'fortuna',
    eventType: PROSPECT_EVENT,
    payload: { ...payload, idempotency_key: prospect.idempotencyKey } as Record<string, unknown>,
    processedAt: new Date(),
  })
  return outcome
}

/**
 * A prospect qualified (and dispatched by a human operator) in Fortuna is
 * recorded for staff review. These are cold prospects with no consent on
 * record, and recording them must never change who else can be mailed:
 * - nothing here sends, enqueues or enrolls anything;
 * - when the scraped email matches no contact, a new contact is created with
 *   `marketingConsent = false` and an `unsubscribed = true` lead, plus a note;
 * - when it matches an existing contact, only a note is added to that contact:
 *   no lead (an unsubscribed lead would block campaigns to it) and no update.
 * Retries are serialized per idempotency key inside the transaction.
 */
async function processProspectQualified(payload: FortunaProspectPayload, remaining: number) {
  const timestampError = eventTimestampError(payload.timestamp)
  if (timestampError) return timestampError

  const prospect = parseProspect(payload)
  if (!prospect) return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })

  const { ctx, db } = createFortunaServiceContext()
  const stage = await resolveDefaultLeadStage(ctx)
  if (!stage) {
    logger.error('Default pipeline or its first stage not found — cannot create prospect lead')
    return NextResponse.json({ error: 'Pipeline not configured' }, { status: 500 })
  }

  const result = await db.transaction((tx) =>
    recordProspect(tx, prospect, stage, payload, ctx.auth.userId),
  )

  if ('deduplicated' in result) {
    return NextResponse.json(
      { received: true, deduplicated: true },
      { headers: { 'X-RateLimit-Remaining': String(remaining) } },
    )
  }

  logger.info(
    { ...result, prospectId: prospect.prospectId },
    result.matchedExistingContact
      ? 'Prospect qualified — matched an existing contact, review note added'
      : 'Prospect qualified — contact, lead and note recorded for review',
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

function payloadTooLarge() {
  return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
}
/** The raw body, or null when it is larger than MAX_BODY_BYTES (declared or actual). */
async function readBodyCapped(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null
  if (!req.body) return ''

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel()
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

export async function POST(req: Request) {
  const secret = process.env.FORTUNA_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  const { remaining, response } = await checkWebhookRateLimit(req)
  if (response) return response

  const timestampError = validateTimestamp(req)
  if (timestampError) return timestampError

  const body = await readBodyCapped(req)
  if (body === null) return payloadTooLarge()

  // Signature validation — Fortuna's own header names (see SIGNATURE_HEADERS), not X-Webhook-Signature
  const signatureError = validateSignature(req, body, secret)
  if (signatureError) return signatureError

  try {
    return await processFortunaPayload(body, remaining)
  } catch (error) {
    logger.error({ err: error }, 'Fortuna webhook processing error')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}

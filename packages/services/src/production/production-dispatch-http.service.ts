import { createHmac } from 'node:crypto'
import type { getDb } from '@phyne/db'
import { engagementEvents, externalReferences } from '@phyne/db/schema'
import { createLogger } from '@phyne/logging'
import { and, eq } from 'drizzle-orm'

const logger = createLogger('services:production-dispatch-http')

type ProductionDispatchDb = ReturnType<typeof getDb>
type ProductionProvider = 'pravara' | 'selva'
type DispatchStatus = 'failed' | 'missing' | 'sent' | 'skipped'

type EnvMap = Record<string, string | undefined>

interface ProductionDispatchReference {
  entityId: string
  externalId: string
  id: string
  metadata: Record<string, unknown> | null
  provider: string
}

interface ProviderDispatchConfig {
  apiKey?: string
  endpoint: string
  hmacSecret?: string
}

export interface DispatchProductionOptions {
  env?: EnvMap
  fetcher?: typeof fetch
  limit?: number
  now?: Date
  referenceId?: string
}

export interface DispatchProductionSummary {
  failed: number
  scanned: number
  sent: number
  skipped: number
}

export interface DispatchProductionResult {
  provider: string | null
  referenceId: string
  status: DispatchStatus
}

export async function listPendingProductionDispatchReferenceIds(
  db: ProductionDispatchDb,
  options: Pick<DispatchProductionOptions, 'limit' | 'referenceId'> = {},
) {
  const references = await loadProductionDispatchReferences(db, options)
  return references
    .filter((reference) => isDispatchableMetadata(reference.metadata))
    .map((reference) => reference.id)
}

export async function dispatchPendingProductionDispatches(
  db: ProductionDispatchDb,
  options: DispatchProductionOptions = {},
): Promise<DispatchProductionSummary> {
  const references = await loadProductionDispatchReferences(db, options)
  const summary: DispatchProductionSummary = {
    failed: 0,
    scanned: references.length,
    sent: 0,
    skipped: 0,
  }

  for (const reference of references) {
    const result = await dispatchProductionDispatchReferenceRow(db, reference, options)
    if (result.status === 'sent') summary.sent += 1
    else if (result.status === 'failed') summary.failed += 1
    else summary.skipped += 1
  }

  return summary
}

export async function dispatchProductionDispatchReference(
  db: ProductionDispatchDb,
  referenceId: string,
  options: Omit<DispatchProductionOptions, 'referenceId'> = {},
): Promise<DispatchProductionResult> {
  const [reference] = await loadProductionDispatchReferences(db, { ...options, referenceId })
  if (!reference) return { provider: null, referenceId, status: 'missing' }
  return dispatchProductionDispatchReferenceRow(db, reference, options)
}

async function dispatchProductionDispatchReferenceRow(
  db: ProductionDispatchDb,
  reference: ProductionDispatchReference,
  options: DispatchProductionOptions,
): Promise<DispatchProductionResult> {
  const metadata = normalizeMetadata(reference.metadata)
  if (!isDispatchableMetadata(metadata)) {
    return { provider: reference.provider, referenceId: reference.id, status: 'skipped' }
  }

  if (!isProductionProvider(reference.provider)) {
    logger.warn(
      { provider: reference.provider, referenceId: reference.id },
      'Unsupported production dispatch provider',
    )
    return { provider: reference.provider, referenceId: reference.id, status: 'skipped' }
  }

  const config = resolveProviderConfig(reference.provider, options.env ?? process.env)
  if (!config) {
    logger.warn(
      { provider: reference.provider, referenceId: reference.id },
      'Production dispatch provider is not configured',
    )
    return { provider: reference.provider, referenceId: reference.id, status: 'skipped' }
  }

  const now = options.now ?? new Date()
  const payload = buildDispatchPayload(reference, metadata, now)
  const body = JSON.stringify(payload)
  const fetcher = options.fetcher ?? fetch

  logger.info(
    { endpoint: config.endpoint, provider: reference.provider, referenceId: reference.id },
    'Dispatching paid production handoff',
  )

  const response = await fetcher(config.endpoint, {
    method: 'POST',
    headers: buildHeaders(reference, config, body, payload.timestamp),
    body,
    signal: AbortSignal.timeout(dispatchTimeoutMs(options.env ?? process.env)),
  }).catch(async (err: unknown) => {
    await recordDispatchFailure(db, reference, metadata, now, 0, errorMessage(err))
    return null
  })

  if (!response)
    return { provider: reference.provider, referenceId: reference.id, status: 'failed' }

  if (!response.ok) {
    const responseBody = await response.text().catch(() => 'unreadable response body')
    await recordDispatchFailure(db, reference, metadata, now, response.status, responseBody)
    return { provider: reference.provider, referenceId: reference.id, status: 'failed' }
  }

  const responseBody = await parseResponseBody(response)
  await recordDispatchSuccess(db, reference, metadata, now, response.status, responseBody)
  return { provider: reference.provider, referenceId: reference.id, status: 'sent' }
}

async function loadProductionDispatchReferences(
  db: ProductionDispatchDb,
  options: Pick<DispatchProductionOptions, 'limit' | 'referenceId'>,
): Promise<ProductionDispatchReference[]> {
  const conditions = [
    eq(externalReferences.entityType, 'order'),
    eq(externalReferences.externalType, 'production_dispatch'),
  ]
  if (options.referenceId) conditions.push(eq(externalReferences.id, options.referenceId))

  return db
    .select({
      entityId: externalReferences.entityId,
      externalId: externalReferences.externalId,
      id: externalReferences.id,
      metadata: externalReferences.metadata,
      provider: externalReferences.provider,
    })
    .from(externalReferences)
    .where(and(...conditions))
    .limit(normalizeLimit(options.limit))
}

function buildDispatchPayload(
  reference: ProductionDispatchReference,
  metadata: Record<string, unknown>,
  now: Date,
) {
  return {
    type: 'production.dispatch.requested',
    timestamp: now.toISOString(),
    data: {
      dispatch_id: reference.id,
      external_id: reference.externalId,
      track: pickString(metadata.track),
      provider: reference.provider,
      engagement_id: pickString(metadata.engagement_id),
      order_id: pickString(metadata.order_id) ?? reference.entityId,
      order_number: pickString(metadata.order_number),
      quote_id: pickString(metadata.quote_id),
      payment_event_id: pickString(metadata.payment_event_id),
      payment_reference: pickString(metadata.payment_reference),
      currency: pickString(metadata.currency),
      total_amount: pickString(metadata.total_amount),
      requested_at: now.toISOString(),
    },
  }
}

function buildHeaders(
  reference: ProductionDispatchReference,
  config: ProviderDispatchConfig,
  body: string,
  timestamp: string,
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': `production-dispatch:${reference.id}`,
  }

  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  if (config.hmacSecret) {
    const signature = createHmac('sha256', config.hmacSecret).update(body).digest('hex')
    headers['X-PhyneCRM-Signature'] = `sha256=${signature}`
    headers['X-Webhook-Timestamp'] = timestamp
  }

  return headers
}

async function recordDispatchSuccess(
  db: ProductionDispatchDb,
  reference: ProductionDispatchReference,
  metadata: Record<string, unknown>,
  now: Date,
  statusCode: number,
  responseBody: Record<string, unknown>,
) {
  const providerResponseId = providerResponseIdFrom(responseBody)
  const nextMetadata = {
    ...metadata,
    dispatch_status: 'sent',
    dispatched_at: now.toISOString(),
    last_attempt_at: now.toISOString(),
    last_status_code: statusCode,
    provider_response_id: providerResponseId ?? null,
  }

  await updateDispatchMetadata(db, reference.id, nextMetadata)
  await recordDispatchEvent(db, reference, nextMetadata, {
    eventType: 'system:production_dispatch_sent',
    message: `Production dispatch sent to ${reference.provider} for ${pickString(metadata.track) ?? 'track'}`,
    status: 'completed',
    suffix: 'sent',
  })
}

async function recordDispatchFailure(
  db: ProductionDispatchDb,
  reference: ProductionDispatchReference,
  metadata: Record<string, unknown>,
  now: Date,
  statusCode: number,
  responseBody: string,
) {
  const attemptCount = pickNumber(metadata.attempt_count) + 1
  const nextMetadata = {
    ...metadata,
    attempt_count: attemptCount,
    dispatch_status: 'retry',
    last_attempt_at: now.toISOString(),
    last_error: truncate(responseBody, 1000),
    last_status_code: statusCode,
  }

  await updateDispatchMetadata(db, reference.id, nextMetadata)
  await recordDispatchEvent(db, reference, nextMetadata, {
    eventType: 'system:production_dispatch_failed',
    message: `Production dispatch to ${reference.provider} failed for ${pickString(metadata.track) ?? 'track'}`,
    status: 'failed',
    suffix: `failed:${attemptCount}`,
  })
}

async function updateDispatchMetadata(
  db: ProductionDispatchDb,
  referenceId: string,
  metadata: Record<string, unknown>,
) {
  await db
    .update(externalReferences)
    .set({ metadata })
    .where(eq(externalReferences.id, referenceId))
}

async function recordDispatchEvent(
  db: ProductionDispatchDb,
  reference: ProductionDispatchReference,
  metadata: Record<string, unknown>,
  event: { eventType: string; message: string; status: string; suffix: string },
) {
  const engagementId = pickString(metadata.engagement_id)
  if (!engagementId) return

  const orderId = pickString(metadata.order_id) ?? reference.entityId
  const track = pickString(metadata.track) ?? 'unknown'
  await db.insert(engagementEvents).values({
    engagementId,
    source: 'system',
    eventType: event.eventType,
    status: event.status,
    message: event.message,
    metadata: {
      dispatch_reference_id: reference.id,
      order_id: orderId,
      provider: reference.provider,
      track,
    },
    dedupKey: `dispatch:${orderId}:${track}:${event.suffix}`,
  })
}

function resolveProviderConfig(
  provider: ProductionProvider,
  env: EnvMap,
): ProviderDispatchConfig | null {
  if (provider === 'pravara') {
    const endpoint =
      env.PRAVARA_DISPATCH_URL ?? appendPath(env.PRAVARA_BASE_URL, '/api/v1/fabrication/dispatches')
    const apiKey = env.PRAVARA_API_KEY
    const hmacSecret = env.PRAVARA_DISPATCH_SECRET ?? env.PHYNECRM_OUTBOUND_SECRET
    return endpoint && (apiKey || hmacSecret) ? { apiKey, endpoint, hmacSecret } : null
  }

  const endpoint =
    env.SELVA_DISPATCH_URL ??
    appendPath(env.SELVA_API_URL ?? env.SELVA_BASE_URL, '/api/v1/projects/dispatches')
  const apiKey = env.SELVA_API_KEY
  const hmacSecret = env.SELVA_DISPATCH_SECRET ?? env.PHYNECRM_OUTBOUND_SECRET
  return endpoint && (apiKey || hmacSecret) ? { apiKey, endpoint, hmacSecret } : null
}

function isProductionProvider(provider: string): provider is ProductionProvider {
  return provider === 'pravara' || provider === 'selva'
}

function isDispatchableMetadata(metadata: Record<string, unknown> | null) {
  const status = pickString(metadata?.dispatch_status)
  return status === 'requested' || status === 'retry'
}

function normalizeMetadata(metadata: Record<string, unknown> | null) {
  return metadata ?? {}
}

function normalizeLimit(limit: number | undefined) {
  if (!limit) return 25
  return Math.max(1, Math.min(limit, 100))
}

function dispatchTimeoutMs(env: EnvMap) {
  const parsed = Number.parseInt(env.PRODUCTION_DISPATCH_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15_000
}

function appendPath(baseUrl: string | undefined, path: string) {
  if (!baseUrl) return null
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

async function parseResponseBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => '')
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return { body: text }
  }
}

function providerResponseIdFrom(responseBody: Record<string, unknown>) {
  return (
    pickString(responseBody.id) ??
    pickString(responseBody.dispatch_id) ??
    pickString(responseBody.job_id) ??
    pickString(responseBody.external_id)
  )
}

function pickString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function pickNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message
  return String(err)
}

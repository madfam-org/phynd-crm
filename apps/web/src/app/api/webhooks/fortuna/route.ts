import { getCacheManager } from '@/lib/federation/clients'
import { checkRateLimit } from '@/lib/webhooks/rate-limiter'
import { resolveRedisUrl } from '@phynd/config/connections'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { pipelineStages, pipelines } from '@phynd/db/schema'
import { validateWebhookSignature } from '@phynd/federation/webhooks'
import { createLogger } from '@phynd/logging'
import { GrantsService, createServiceContext } from '@phynd/services'
import { Queue } from 'bullmq'
import { eq } from 'drizzle-orm'
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

async function processFortunaPayload(body: string, remaining: number) {
  const payload = JSON.parse(body) as FortunaGrantPayload

  if (payload.type !== 'grant.discovered') {
    logger.info({ eventType: payload.type }, 'Ignoring non-grant.discovered event')
    return NextResponse.json(
      { received: true },
      { headers: { 'X-RateLimit-Remaining': String(remaining) } },
    )
  }

  return processGrantDiscovered(payload, remaining)
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

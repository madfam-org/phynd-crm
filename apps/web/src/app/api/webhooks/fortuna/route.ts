import { getCacheManager } from '@/lib/federation/clients'
import { checkRateLimit } from '@/lib/webhooks/rate-limiter'
import { DEFAULT_TENANT_ID } from '@phyne/config/constants'
import { getDb } from '@phyne/db'
import { grantOpportunities, pipelineStages, pipelines } from '@phyne/db/schema'
import { validateWebhookSignature } from '@phyne/federation/webhooks'
import { createLogger } from '@phyne/logging'
import { GrantsService, createServiceContext } from '@phyne/services'
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

export async function POST(req: Request) {
  const secret = process.env.FORTUNA_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  // Rate limiting
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { allowed, remaining } = await checkRateLimit(ip)

  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      {
        status: 429,
        headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' },
      },
    )
  }

  // Timestamp validation
  const timestamp = req.headers.get('x-webhook-timestamp')
  if (timestamp) {
    const age = Date.now() - new Date(timestamp).getTime()
    if (Number.isNaN(age) || age > MAX_TIMESTAMP_AGE_MS) {
      return NextResponse.json({ error: 'Webhook timestamp expired' }, { status: 401 })
    }
  }

  // Signature validation — Fortuna uses X-Fortuna-Signature instead of X-Webhook-Signature
  const body = await req.text()
  const signature = req.headers.get('x-fortuna-signature') ?? ''

  if (!validateWebhookSignature(body, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  try {
    const payload = JSON.parse(body) as FortunaGrantPayload

    if (payload.type !== 'grant.discovered') {
      logger.info({ eventType: payload.type }, 'Ignoring non-grant.discovered event')
      return NextResponse.json(
        { received: true },
        { headers: { 'X-RateLimit-Remaining': String(remaining) } },
      )
    }

    const grantData = payload.data
    if (!grantData?.fortuna_grant_id || !grantData?.title) {
      logger.warn({ payload }, 'Malformed grant.discovered payload — skipping')
      return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
    }

    const db = getDb()
    const cache = getCacheManager()

    const botAuth = {
      userId: 'system:fortuna-webhook',
      tenantId: DEFAULT_TENANT_ID,
      roles: ['admin'],
      scopes: ['*'],
      accessToken: 'internal:fortuna-webhook',
    }

    const ctx = createServiceContext(db, cache, botAuth)
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

    // Find the Treasury Hunter pipeline and its Discovered stage
    const [treasuryPipeline] = await db
      .select()
      .from(pipelines)
      .where(eq(pipelines.name, 'Treasury Hunter'))

    if (!treasuryPipeline) {
      logger.error('Treasury Hunter pipeline not found — cannot create application')
      return NextResponse.json({ error: 'Pipeline not configured' }, { status: 500 })
    }

    const stages = await db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, treasuryPipeline.id))

    const discoveredStage = stages.find((s) => s.name === 'Discovered')
    if (!discoveredStage) {
      logger.error('Discovered stage not found in Treasury Hunter pipeline')
      return NextResponse.json({ error: 'Stage not configured' }, { status: 500 })
    }

    // Check if application already exists for this opportunity (idempotency)
    const existingApps = await db
      .select()
      .from(grantOpportunities)
      .where(eq(grantOpportunities.id, opportunity.id))

    // Create grant application at Discovered stage
    const application = await grantsService.createApplication({
      grantOpportunityId: opportunity.id,
      pipelineId: treasuryPipeline.id,
      stageId: discoveredStage.id,
      requestedAmount: grantData.max_amount,
    })

    // Enqueue compliance check job
    try {
      const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
      const url = new URL(redisUrl)
      const connection = {
        host: url.hostname,
        port: Number(url.port) || 6379,
        password: url.password || undefined,
      }
      const queue = new Queue('grant-compliance-check', { connection })
      await queue.add('check', {
        grantApplicationId: application.id,
        grantOpportunityId: opportunity.id,
        fortunaGrantId: grantData.fortuna_grant_id,
      })
      await queue.close()
    } catch (err) {
      // Non-blocking: compliance check enqueue failure should not break webhook processing
      logger.error({ err }, 'Failed to enqueue grant-compliance-check job')
    }

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
  } catch (error) {
    logger.error({ err: error }, 'Fortuna webhook processing error')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}

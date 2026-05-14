import { getCacheManager } from '@/lib/federation/clients'
import { handleWebhook } from '@/lib/webhooks/handler'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import {
  ContactsService,
  LeadsService,
  PipelinesService,
  RedditBotService,
  createServiceContext,
} from '@phynd/services'
import type { AuthContext } from '@phynd/types/auth'
import { Queue } from 'bullmq'
import { NextResponse } from 'next/server'

const logger = createLogger('web:webhook:tezca')
type TezcaServiceContext = ReturnType<typeof createServiceContext>
type TezcaWebhookPayload = { type?: string; event?: string; data?: unknown }

/**
 * Reddit bot payload shape — has outreach_target + legal_context.
 */
interface RedditBotPayload {
  campaign_type: string
  bot_identity: string
  outreach_target: {
    url: string
    author: string
    original_post_content: string
  }
  legal_context: {
    distress_sentiment: string
    core_legal_problem: string
    domain: string
  }
  orchestration: {
    instruction: string
  }
}

/**
 * Tezca landing page interest payload — has email + feature_key.
 */
interface TezcaInterestPayload {
  email: string
  feature_key: string
  use_case?: string
  wishlist?: string
  janua_user_id?: string
  source_page?: string
  created_at?: string
}

function isRedditBotPayload(data: unknown): data is RedditBotPayload {
  const d = data as Record<string, unknown>
  return (
    typeof d?.outreach_target === 'object' &&
    d.outreach_target !== null &&
    'url' in (d.outreach_target as Record<string, unknown>) &&
    typeof d?.legal_context === 'object' &&
    d.legal_context !== null
  )
}

/**
 * Tezca newsletter subscription payload — has email + topics.
 */
interface TezcaNewsletterPayload {
  email: string
  topics: string[]
  source_page?: string
}

function isTezcaInterestPayload(data: unknown): data is TezcaInterestPayload {
  const d = data as Record<string, unknown>
  return typeof d?.email === 'string' && typeof d?.feature_key === 'string'
}

function isTezcaNewsletterPayload(data: unknown): data is TezcaNewsletterPayload {
  const d = data as Record<string, unknown>
  return typeof d?.email === 'string' && !('feature_key' in (d ?? {}))
}

/** Enqueue the first drip email for a newly created lead (non-blocking). */
async function enqueueDrip(leadId: string): Promise<void> {
  try {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
    const url = new URL(redisUrl)
    const connection = {
      host: url.hostname,
      port: Number(url.port) || 6379,
      password: url.password || undefined,
    }
    const queue = new Queue('email-drip', { connection })
    await queue.add('drip', { leadId, step: 0 }, { delay: 0, jobId: `drip-${leadId}-step-0` })
    await queue.close()
  } catch (err) {
    logger.warn({ err, leadId }, 'Failed to enqueue drip — non-blocking')
  }
}

function createTezcaContext(): TezcaServiceContext {
  const botAuth: AuthContext = {
    userId: 'system:tezca-bot',
    tenantId: DEFAULT_TENANT_ID,
    roles: ['admin'],
    scopes: ['*'],
    accessToken: 'internal:tezca-webhook',
  }

  return createServiceContext(getDb(), getCacheManager(), botAuth)
}

async function ensureContact(ctx: TezcaServiceContext, email: string, externalJanuaId?: string) {
  const contactsService = new ContactsService(ctx)
  let contact = await contactsService.getByEmail(email)

  if (!contact) {
    contact = await contactsService.create({
      name: email.split('@')[0] ?? email,
      email,
      ...(externalJanuaId ? { externalJanuaId } : {}),
    })
    logger.info({ contactId: contact.id }, 'Created contact from Tezca webhook')
  }

  return contact
}

async function createDefaultLead(ctx: TezcaServiceContext, contactId: string, source: string) {
  const leadsService = new LeadsService(ctx)
  const pipelinesService = new PipelinesService(ctx)
  const pipeline = await pipelinesService.getDefault()
  if (!pipeline) return null

  const stages = await pipelinesService.getStages(pipeline.id)
  const firstStage = stages[0]
  if (!firstStage) return null

  const lead = await leadsService.create({
    contactId,
    source,
    pipelineId: pipeline.id,
    stageId: firstStage.id,
  })
  await enqueueDrip(lead.id)
  return lead
}

async function handleNewsletter(data: TezcaNewsletterPayload, ctx: TezcaServiceContext) {
  logger.info({ email: data.email }, 'Processing Tezca newsletter subscription')
  const contact = await ensureContact(ctx, data.email)
  const lead = await createDefaultLead(ctx, contact.id, 'tezca_newsletter')
  if (lead) {
    logger.info(
      { contactId: contact.id, source: 'tezca_newsletter' },
      'Created lead from Tezca newsletter subscription',
    )
  }
}

async function handleInterest(data: TezcaInterestPayload, ctx: TezcaServiceContext) {
  logger.info(
    { email: data.email, featureKey: data.feature_key },
    'Processing Tezca interest event',
  )
  const contact = await ensureContact(ctx, data.email, data.janua_user_id)
  const source = `tezca_interest:${data.feature_key}`
  const lead = await createDefaultLead(ctx, contact.id, source)
  if (lead) {
    logger.info({ contactId: contact.id, source }, 'Created lead from Tezca interest event')
  }
}

async function handleRedditBot(data: RedditBotPayload, ctx: TezcaServiceContext, raw: unknown) {
  if (!data.outreach_target.url || !data.legal_context.core_legal_problem) {
    logger.warn({ payload: raw }, 'Malformed Reddit bot payload — skipping')
    return
  }

  const botService = new RedditBotService(ctx)

  logger.info(
    { url: data.outreach_target.url, domain: data.legal_context.domain },
    'Processing Reddit bot interest.created event',
  )

  const result = await botService.processWebhook(data)

  logger.info(
    { campaignId: result.draft_stage_id, contactId: result.contactId },
    'Interest event processed — draft staged for approval',
  )
}

async function handleTezcaEvent(raw: Record<string, unknown>) {
  const payload = raw as TezcaWebhookPayload
  const eventType = (payload.type ?? payload.event ?? 'unknown') as string
  const data = payload.data

  if (!data) {
    logger.warn({ payload: raw }, 'Tezca event has no data — skipping')
    return
  }

  const ctx = createTezcaContext()

  if (eventType === 'newsletter.subscribed' && isTezcaNewsletterPayload(data)) {
    await handleNewsletter(data, ctx)
    return
  }

  if (eventType !== 'interest.created') {
    logger.info({ eventType }, 'Ignoring unhandled event type')
    return
  }

  if (isTezcaInterestPayload(data)) {
    await handleInterest(data, ctx)
    return
  }

  if (isRedditBotPayload(data)) {
    await handleRedditBot(data, ctx, raw)
    return
  }

  logger.warn({ payload: raw }, 'interest.created event has unrecognized payload shape — skipping')
}

export async function POST(req: Request) {
  const secret = process.env.TEZCA_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: handleTezcaEvent,
  })
}

import { getCacheManager } from '@/lib/federation/clients'
import { handleWebhook } from '@/lib/webhooks/handler'
import { resolveRedisUrl } from '@phynd/config/connections'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import {
  CampaignsService,
  ContactsService,
  ConversionsService,
  LeadsService,
  PipelinesService,
  createServiceContext,
} from '@phynd/services'
import { Queue } from 'bullmq'
import { NextResponse } from 'next/server'

const logger = createLogger('web:webhook:ceq')

/**
 * ceq InterestGate payload — captured by `apps/api/src/ceq_api/services/crm_sync.py`
 * when a free user clicks a premium-tagged template's CTA. Mirrors the Tezca
 * shape; the optional UTM fields are added by ceq when the user landed via
 * a tracked marketing campaign URL (Phase 2 of the ceq audit hookup).
 */
interface CeqInterestPayload {
  email: string
  feature_key: string
  wishlist?: string
  janua_user_id?: string
  source_page?: string
  created_at?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
}

type CeqEventPayload = {
  data?: unknown
  event?: string
  type?: string
}

type CeqServiceContext = ReturnType<typeof createServiceContext>
type CeqContact = NonNullable<Awaited<ReturnType<ContactsService['getByEmail']>>>

function isCeqInterestPayload(data: unknown): data is CeqInterestPayload {
  const d = data as Record<string, unknown>
  return typeof d?.email === 'string' && typeof d?.feature_key === 'string'
}

/** Enqueue the first drip email for a newly created lead (non-blocking). */
async function enqueueDrip(leadId: string): Promise<void> {
  try {
    const redisUrl = resolveRedisUrl()
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

function getInterestPayload(raw: unknown): CeqInterestPayload | null {
  const payload = raw as CeqEventPayload
  const eventType = payload.type ?? payload.event ?? 'unknown'

  if (!payload.data) {
    logger.warn({ payload: raw }, 'ceq event has no data — skipping')
    return null
  }

  if (eventType !== 'interest.created') {
    logger.info({ eventType }, 'Ignoring unhandled ceq event type')
    return null
  }

  if (!isCeqInterestPayload(payload.data)) {
    logger.warn({ payload: raw }, 'ceq interest.created has unrecognized payload shape')
    return null
  }

  return payload.data
}

function createCeqServiceContext(): CeqServiceContext {
  const db = getDb()
  const cache = getCacheManager()
  const auth = {
    userId: 'system:ceq-webhook',
    tenantId: DEFAULT_TENANT_ID,
    roles: ['admin'] as string[],
    scopes: ['*'] as string[],
    accessToken: 'internal:ceq-webhook',
  }
  return createServiceContext(db, cache, auth)
}

async function upsertContact(
  data: CeqInterestPayload,
  contactsService: ContactsService,
): Promise<CeqContact> {
  const existing = await contactsService.getByEmail(data.email)
  if (existing) return existing

  const contact = await contactsService.create({
    name: data.email.split('@')[0] ?? data.email,
    email: data.email,
    ...(data.janua_user_id ? { externalJanuaId: data.janua_user_id } : {}),
  })
  logger.info({ contactId: contact.id }, 'Created contact from ceq interest')
  return contact
}

async function resolveInitialPipelineStage(pipelinesService: PipelinesService) {
  const pipeline = await pipelinesService.getDefault()
  if (!pipeline) {
    logger.warn('No default pipeline — skipping lead creation')
    return null
  }

  const firstStage = (await pipelinesService.getStages(pipeline.id))[0]
  if (!firstStage) {
    logger.warn({ pipelineId: pipeline.id }, 'Default pipeline has no stages')
    return null
  }

  return { firstStage, pipeline }
}

async function recordCampaignAttribution(
  data: CeqInterestPayload,
  ctx: CeqServiceContext,
  contactId: string,
  leadId: string,
) {
  if (!data.utm_campaign) return

  try {
    const campaignsService = new CampaignsService(ctx)
    const campaign = await campaignsService.getByUtmCampaign(data.utm_campaign)
    if (!campaign) {
      logger.info(
        { utm_campaign: data.utm_campaign },
        'No matching campaign for utm_campaign — lead created without attribution',
      )
      return
    }

    const conversionsService = new ConversionsService(ctx)
    await conversionsService.recordConversion({
      type: 'paid_lead',
      contactId,
      leadId,
      campaignId: campaign.id,
      metadata: {
        utm_source: data.utm_source,
        utm_medium: data.utm_medium,
        utm_campaign: data.utm_campaign,
        source_page: data.source_page,
        feature_key: data.feature_key,
      },
    })
    logger.info(
      {
        leadId,
        campaignId: campaign.id,
        utm_campaign: data.utm_campaign,
      },
      'Attributed ceq lead to paid campaign',
    )
  } catch (err) {
    // Conversion attribution must not fail the lead creation.
    logger.warn({ err, leadId }, 'UTM attribution failed — non-blocking')
  }
}

async function handleCeqInterestEvent(raw: unknown) {
  const data = getInterestPayload(raw)
  if (!data) return

  logger.info(
    {
      email: data.email,
      featureKey: data.feature_key,
      utm: data.utm_campaign,
    },
    'Processing ceq interest.created event',
  )

  const ctx = createCeqServiceContext()
  const contactsService = new ContactsService(ctx)
  const leadsService = new LeadsService(ctx)
  const pipelinesService = new PipelinesService(ctx)

  const contact = await upsertContact(data, contactsService)
  const stageConfig = await resolveInitialPipelineStage(pipelinesService)
  if (!stageConfig) return

  // Source string carries the feature_key so the funnel report can segment by
  // which premium template drove the conversion.
  const source = `ceq_interest:${data.feature_key}`
  const lead = await leadsService.create({
    contactId: contact.id,
    source,
    pipelineId: stageConfig.pipeline.id,
    stageId: stageConfig.firstStage.id,
  })

  logger.info(
    {
      contactId: contact.id,
      source,
      utm_campaign: data.utm_campaign,
    },
    'Created lead from ceq interest event',
  )

  await enqueueDrip(lead.id)
  await recordCampaignAttribution(data, ctx, contact.id, lead.id)
}

export async function POST(req: Request) {
  const secret = process.env.CEQ_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: handleCeqInterestEvent,
  })
}

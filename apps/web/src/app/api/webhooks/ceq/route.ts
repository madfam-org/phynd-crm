import { getCacheManager } from '@/lib/federation/clients'
import { handleWebhook } from '@/lib/webhooks/handler'
import { DEFAULT_TENANT_ID } from '@phyne/config/constants'
import { getDb } from '@phyne/db'
import { createLogger } from '@phyne/logging'
import {
  ContactsService,
  LeadsService,
  PipelinesService,
  createServiceContext,
} from '@phyne/services'
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

function isCeqInterestPayload(data: unknown): data is CeqInterestPayload {
  const d = data as Record<string, unknown>
  return typeof d?.email === 'string' && typeof d?.feature_key === 'string'
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

export async function POST(req: Request) {
  const secret = process.env.CEQ_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: async (raw) => {
      const payload = raw as { type?: string; event?: string; data?: unknown }
      const eventType = (payload.type ?? payload.event ?? 'unknown') as string

      const data = payload.data
      if (!data) {
        logger.warn({ payload: raw }, 'ceq event has no data — skipping')
        return
      }

      if (eventType !== 'interest.created') {
        logger.info({ eventType }, 'Ignoring unhandled ceq event type')
        return
      }

      if (!isCeqInterestPayload(data)) {
        logger.warn({ payload: raw }, 'ceq interest.created has unrecognized payload shape')
        return
      }

      logger.info(
        {
          email: data.email,
          featureKey: data.feature_key,
          utm: data.utm_campaign,
        },
        'Processing ceq interest.created event',
      )

      const db = getDb()
      const cache = getCacheManager()
      const auth = {
        userId: 'system:ceq-webhook',
        tenantId: DEFAULT_TENANT_ID,
        roles: ['admin'] as string[],
        scopes: ['*'] as string[],
        accessToken: 'internal:ceq-webhook',
      }
      const ctx = createServiceContext(db, cache, auth)

      const contactsService = new ContactsService(ctx)
      const leadsService = new LeadsService(ctx)
      const pipelinesService = new PipelinesService(ctx)

      // Upsert contact by email — Janua linking when available.
      let contact = await contactsService.getByEmail(data.email)
      if (!contact) {
        contact = await contactsService.create({
          name: data.email.split('@')[0] ?? data.email,
          email: data.email,
          ...(data.janua_user_id ? { externalJanuaId: data.janua_user_id } : {}),
        })
        logger.info({ contactId: contact.id }, 'Created contact from ceq interest')
      }

      const pipeline = await pipelinesService.getDefault()
      if (!pipeline) {
        logger.warn('No default pipeline — skipping lead creation')
        return
      }
      const stages = await pipelinesService.getStages(pipeline.id)
      const firstStage = stages[0]
      if (!firstStage) {
        logger.warn({ pipelineId: pipeline.id }, 'Default pipeline has no stages')
        return
      }

      // Source string carries the feature_key so the funnel report can
      // segment by which premium template drove the conversion.
      const source = `ceq_interest:${data.feature_key}`

      const lead = await leadsService.create({
        contactId: contact.id,
        source,
        pipelineId: pipeline.id,
        stageId: firstStage.id,
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

      // UTM-driven attribution to a campaign row is deferred to Phase 2 of the
      // ceq hookup spec — needs the campaign-lookup-by-utm_campaign service
      // method that doesn't exist yet (`CampaignsService.getByUtmCampaign`).
      // For now, the source string carries the campaign signal and analytics
      // can JOIN on it.
    },
  })
}

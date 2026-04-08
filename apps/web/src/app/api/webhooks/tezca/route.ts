import { getCacheManager } from '@/lib/federation/clients'
import { handleWebhook } from '@/lib/webhooks/handler'
import { getDb } from '@phyne/db'
import { createLogger } from '@phyne/logging'
import {
  ContactsService,
  LeadsService,
  PipelinesService,
  RedditBotService,
  createServiceContext,
} from '@phyne/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:webhook:tezca')

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

function isTezcaInterestPayload(data: unknown): data is TezcaInterestPayload {
  const d = data as Record<string, unknown>
  return typeof d?.email === 'string' && typeof d?.feature_key === 'string'
}

export async function POST(req: Request) {
  const secret = process.env.TEZCA_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: async (raw) => {
      const payload = raw as { type?: string; event?: string; data?: unknown }
      const eventType = (payload.type ?? payload.event ?? 'unknown') as string

      if (eventType !== 'interest.created') {
        logger.info({ eventType }, 'Ignoring non-interest.created event')
        return
      }

      const data = payload.data
      if (!data) {
        logger.warn({ payload: raw }, 'interest.created event has no data — skipping')
        return
      }

      const db = getDb()
      const cache = getCacheManager()
      const botAuth = {
        userId: 'system:tezca-bot',
        tenantId: 'madfam',
        roles: ['admin'] as string[],
        scopes: ['*'] as string[],
        accessToken: 'internal:tezca-webhook',
      }
      const ctx = createServiceContext(db, cache, botAuth)

      // ── Branch 1: Tezca landing page interest (email + feature_key) ──
      if (isTezcaInterestPayload(data)) {
        logger.info(
          { email: data.email, featureKey: data.feature_key },
          'Processing Tezca interest event',
        )

        const contactsService = new ContactsService(ctx)
        const leadsService = new LeadsService(ctx)
        const pipelinesService = new PipelinesService(ctx)

        // Upsert contact by email
        let contact = await contactsService.getByEmail(data.email)
        if (!contact) {
          contact = await contactsService.create({
            name: data.email.split('@')[0] ?? data.email,
            email: data.email,
            ...(data.janua_user_id ? { externalJanuaId: data.janua_user_id } : {}),
          })
          logger.info({ contactId: contact.id }, 'Created contact from Tezca interest')
        }

        // Create lead in default pipeline
        const pipeline = await pipelinesService.getDefault()
        if (pipeline) {
          const stages = await pipelinesService.getStages(pipeline.id)
          const firstStage = stages[0]
          if (firstStage) {
            await leadsService.create({
              contactId: contact.id,
              source: `tezca_interest:${data.feature_key}`,
              pipelineId: pipeline.id,
              stageId: firstStage.id,
            })
            logger.info(
              { contactId: contact.id, source: `tezca_interest:${data.feature_key}` },
              'Created lead from Tezca interest event',
            )
          }
        }

        return
      }

      // ── Branch 2: Reddit bot payload (outreach_target + legal_context) ──
      if (isRedditBotPayload(data)) {
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
        return
      }

      logger.warn(
        { payload: raw },
        'interest.created event has unrecognized payload shape — skipping',
      )
    },
  })
}

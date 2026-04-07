import { getCacheManager } from '@/lib/federation/clients'
import { handleWebhook } from '@/lib/webhooks/handler'
import { getDb } from '@phyne/db'
import { createLogger } from '@phyne/logging'
import { RedditBotService, createServiceContext } from '@phyne/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:webhook:tezca')

/**
 * Tezca webhook route — receives `interest.created` events when Tezca detects
 * a new legal-interest signal (e.g., a Reddit post matched by the external
 * scraper pipeline). This kicks off the full Reddit bot flow:
 *
 *   1. Query Tezca for statutory articles + judicial precedent
 *   2. Generate an LLM draft response
 *   3. Upsert a CRM Contact (by Reddit username)
 *   4. Create a Lead in the default pipeline
 *   5. Stage the draft as a Campaign for human approval
 *
 * The webhook payload must match the `interest.created` event shape and be
 * HMAC-signed with the `TEZCA_WEBHOOK_SECRET`.
 */

interface TezcaInterestPayload {
  type: 'interest.created'
  data: {
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
}

export async function POST(req: Request) {
  const secret = process.env.TEZCA_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: async (raw) => {
      const payload = raw as unknown as TezcaInterestPayload

      if (payload.type !== 'interest.created') {
        logger.info({ eventType: payload.type }, 'Ignoring non-interest.created event')
        return
      }

      const data = payload.data
      if (!data?.outreach_target?.url || !data?.legal_context?.core_legal_problem) {
        logger.warn({ payload: raw }, 'Malformed interest.created payload — skipping')
        return
      }

      const db = getDb()
      const cache = getCacheManager()

      // Minimal auth context for bot-initiated operations (no real user session)
      const botAuth = {
        userId: 'system:tezca-bot',
        tenantId: 'madfam',
        roles: ['admin'],
        scopes: ['*'],
        accessToken: 'internal:tezca-webhook',
      }

      const ctx = createServiceContext(db, cache, botAuth)
      const botService = new RedditBotService(ctx)

      logger.info(
        { url: data.outreach_target.url, domain: data.legal_context.domain },
        'Processing interest.created event',
      )

      const result = await botService.processWebhook(data)

      logger.info(
        { campaignId: result.draft_stage_id, contactId: result.contactId },
        'Interest event processed — draft staged for approval',
      )
    },
  })
}

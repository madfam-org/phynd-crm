import {
  createWebhookEngagementsService,
  resolveTenantIdForWebhook,
} from '@/lib/webhooks/engagement-writer'
import { handleWebhook } from '@/lib/webhooks/handler'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { NextResponse } from 'next/server'

const logger = createLogger('web:engagements-events')

// Unified engagement-event webhook. Any ecosystem service writing a
// project-status update for a tracked engagement posts here with an
// HMAC-signed payload. The dedup_key shape lets any caller make the
// write idempotent without coordination.
//
// Expected payload shape:
//   {
//     engagement_id: string,
//     source: 'pravara'|'selva'|'cotiza'|'karafiel'|'dhanam'|'system',
//     event_type: string,
//     status?: string,
//     message?: string,
//     timestamp?: string,
//     dedup_key?: string,
//     metadata?: Record<string, unknown>
//   }
//
// Secret: PHYND_ENGAGEMENT_EVENTS_SECRET. When unset, returns 503 to fail closed.
export async function POST(req: Request) {
  const secret = process.env.PHYND_ENGAGEMENT_EVENTS_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Engagement events secret not configured' }, { status: 503 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: async (payload) => {
      const engagementId = payload.engagement_id as string | undefined
      const source = payload.source as string | undefined
      const eventType = payload.event_type as string | undefined

      if (!engagementId || !source || !eventType) {
        logger.warn({ payload }, 'engagement event missing required fields')
        return
      }

      const dedupKey =
        (payload.dedup_key as string | undefined) ??
        [source, eventType, payload.timestamp ?? ''].filter(Boolean).join(':')

      const tenantId = resolveTenantIdForWebhook(req)
      const db = getDb(tenantId)
      const service = createWebhookEngagementsService(db, source, tenantId)

      try {
        const result = await service.recordEvent({
          engagementId,
          source,
          eventType,
          status: payload.status as string | undefined,
          message: payload.message as string | undefined,
          metadata: (payload.metadata as Record<string, unknown> | undefined) ?? {},
          dedupKey,
        })
        logger.info(
          { engagementId, source, eventType, deduplicated: result.deduplicated },
          result.deduplicated ? 'engagement event deduplicated' : 'engagement event recorded',
        )
      } catch (err) {
        logger.error({ err, engagementId, source, eventType }, 'engagement event failed')
        throw err
      }
    },
  })
}

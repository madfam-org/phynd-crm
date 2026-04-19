import { handleWebhook } from '@/lib/webhooks/handler'
import { getDb } from '@phyne/db'
import { createLogger } from '@phyne/logging'
import { EngagementsService } from '@phyne/services'
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
//     event_type: string,             // scoped to source, e.g. 'shipped'
//     status?: string,                // pending|in_progress|completed|failed|blocked
//     message?: string,
//     timestamp?: string,             // ISO8601; used for dedup_key
//     dedup_key?: string,             // override; else derived
//     metadata?: Record<string, unknown>
//   }
//
// Secret: PHYNE_ENGAGEMENT_EVENTS_SECRET. Each ecosystem service that
// writes here gets the same secret (service-to-service trust boundary
// is at the network edge via mTLS / Cloudflare service tokens, not
// per-source HMAC). When unset, returns 503 to fail closed.
export async function POST(req: Request) {
  const secret = process.env.PHYNE_ENGAGEMENT_EVENTS_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'Engagement events secret not configured' },
      { status: 503 },
    )
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

      const db = getDb()
      const service = new EngagementsService({
        db,
        // Webhook context: no authenticated user.
        // biome-ignore lint/suspicious/noExplicitAny: webhook caller context
        cache: {} as any,
        auth: {
          userId: `service:${source}`,
          tenantId: 'madfam',
          roles: ['service'],
          scopes: ['engagements:write'],
          accessToken: '',
        },
        tenantId: 'madfam',
      })

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

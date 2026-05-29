import {
  createWebhookEngagementsService,
  resolveTenantIdForWebhook,
} from '@/lib/webhooks/engagement-writer'
import { handleWebhook } from '@/lib/webhooks/handler'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { selvaPortalStatus } from '@phynd/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:selva-webhook')

// Selva digital-milestone webhook → engagement timeline (Phase 2 / WS3).
//
// Expected payload:
//   {
//     engagement_id: string,
//     event: string,              // e.g. milestone_complete
//     external_id: string,        // selva task / deliverable id
//     message?: string,
//     metadata?: object
//   }
//
// Secret: SELVA_WEBHOOK_SECRET (falls back to PHYND_ENGAGEMENT_EVENTS_SECRET).
export async function POST(req: Request) {
  const secret = process.env.SELVA_WEBHOOK_SECRET ?? process.env.PHYND_ENGAGEMENT_EVENTS_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Selva webhook secret not configured' }, { status: 503 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: async (payload) => {
      const engagementId =
        (payload.engagement_id as string | undefined) ??
        (payload.engagementId as string | undefined)
      const event =
        (payload.event as string | undefined) ?? (payload.event_type as string | undefined)
      const externalId =
        (payload.external_id as string | undefined) ??
        (payload.externalId as string | undefined) ??
        (payload.task_id as string | undefined)

      if (!engagementId || !event || !externalId) {
        logger.warn({ payload }, 'selva webhook missing engagement_id, event, or external_id')
        return
      }

      const tenantId = resolveTenantIdForWebhook(req)
      const db = getDb(tenantId)
      const service = createWebhookEngagementsService(db, 'selva', tenantId)

      const result = await service.recordMilestoneWithCanonicalAlias({
        engagementId,
        source: 'selva',
        nativeEventName: event,
        externalId,
        status: selvaPortalStatus(event),
        message: (payload.message as string | undefined) ?? `Selva: ${event}`,
        metadata: (payload.metadata as Record<string, unknown> | undefined) ?? {},
      })

      logger.info(
        {
          engagementId,
          event,
          deduplicated: result.primary.deduplicated,
          aliasRecorded: Boolean(result.alias && !result.alias.deduplicated),
        },
        'selva engagement milestone processed',
      )
    },
  })
}

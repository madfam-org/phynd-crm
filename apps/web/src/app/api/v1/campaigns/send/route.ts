import { resolveTenantIdForWebhook } from '@/lib/webhooks/engagement-writer'
import { handleWebhook } from '@/lib/webhooks/handler'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { CampaignsService, createServiceContext } from '@phynd/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:campaigns-send')

// Tulana/Selva campaign dispatch with consent gates (Phase 3.4).
//
// Expected payload:
//   { campaign_id: string, contact_id: string }
//
// Secret: PHYND_CAMPAIGN_IMPORT_SECRET (falls back to PHYND_ENGAGEMENT_EVENTS_SECRET).
export async function POST(req: Request) {
  const secret =
    process.env.PHYND_CAMPAIGN_IMPORT_SECRET ?? process.env.PHYND_ENGAGEMENT_EVENTS_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Campaign send secret not configured' }, { status: 503 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: async (payload) => {
      const campaignId =
        (payload.campaign_id as string | undefined) ?? (payload.campaignId as string | undefined)
      const contactId =
        (payload.contact_id as string | undefined) ?? (payload.contactId as string | undefined)

      if (!campaignId || !contactId) {
        logger.warn({ payload }, 'campaign send missing campaign_id or contact_id')
        return
      }

      const tenantId = resolveTenantIdForWebhook(req)
      const db = getDb(tenantId)
      const service = new CampaignsService(
        createServiceContext(db, {} as never, {
          userId: 'service:tulana',
          tenantId,
          roles: ['service'],
          scopes: ['campaigns:write'],
          accessToken: '',
        }),
      )

      const result = await service.attemptTulanaSend(campaignId, contactId)
      logger.info(
        { campaignId, contactId, outcome: result.outcome, reasons: result.reasons },
        'tulana campaign send processed',
      )
    },
  })
}

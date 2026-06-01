import { resolveTenantIdForWebhook } from '@/lib/webhooks/engagement-writer'
import { handleWebhook } from '@/lib/webhooks/handler'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { CampaignsService, createServiceContext } from '@phynd/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:campaigns-review')

// Tulana/Selva campaign human-review bridge.
//
// Expected payload:
//   { campaign_id: string, decision: "approved" | "rejected" }
//
// Secret: PHYND_CAMPAIGN_IMPORT_SECRET (dedicated per env; no fallback).
export async function POST(req: Request) {
  const secret = process.env.PHYND_CAMPAIGN_IMPORT_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Campaign review secret not configured' }, { status: 503 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: async (payload) => {
      const campaignId =
        (payload.campaign_id as string | undefined) ?? (payload.campaignId as string | undefined)
      const decision = payload.decision as string | undefined

      if (!campaignId || (decision !== 'approved' && decision !== 'rejected')) {
        logger.warn({ payload }, 'campaign review missing campaign_id or valid decision')
        return
      }

      const tenantId = resolveTenantIdForWebhook(req)
      const db = getDb(tenantId)
      const service = new CampaignsService(
        createServiceContext(db, {} as never, {
          userId: 'service:tulana-review',
          tenantId,
          roles: ['service'],
          scopes: ['campaigns:write'],
          accessToken: '',
        }),
      )

      const result = await service.reviewTulanaImport(campaignId, decision)
      logger.info(
        { campaignId, decision, status: result?.status },
        'tulana campaign review processed',
      )
    },
  })
}

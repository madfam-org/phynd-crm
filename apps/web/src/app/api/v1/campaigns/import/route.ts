import { resolveTenantIdForWebhook } from '@/lib/webhooks/engagement-writer'
import { handleWebhook } from '@/lib/webhooks/handler'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { TulanaCampaignImportService, createServiceContext } from '@phynd/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:campaigns-import')

// Tulana / Selva SKU campaign import (Phase 3 / WS4).
// Contract: docs/TULANA_SKU_CAMPAIGN_INPUTS_2026-05-29.md
//
// Secret: PHYND_CAMPAIGN_IMPORT_SECRET (dedicated per env — no cross-secret fallback).
export async function POST(req: Request) {
  const secret = process.env.PHYND_CAMPAIGN_IMPORT_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Campaign import secret not configured' }, { status: 503 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: async (payload) => {
      const tenantId = resolveTenantIdForWebhook(req)
      const db = getDb(tenantId)
      const service = new TulanaCampaignImportService(
        createServiceContext(db, {} as never, {
          userId: 'service:tulana',
          tenantId,
          roles: ['service'],
          scopes: ['campaigns:write'],
          accessToken: '',
        }),
      )

      const result = await service.importCampaign(payload)
      logger.info(
        { campaignId: result.campaignId, skuKey: result.skuKey, deduplicated: result.deduplicated },
        'tulana campaign import processed',
      )
    },
  })
}

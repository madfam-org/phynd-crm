import { resolveTenantIdForWebhook } from '@/lib/webhooks/engagement-writer'
import { parseSignedWebhookRequest } from '@/lib/webhooks/handler'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { CampaignBuyerSignalService, createServiceContext } from '@phynd/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:campaigns-buyer-signals')

// Tulana buyer-signal export (Phase 3.5) — PII-free rows for WTP/PMF evidence.
//
// Expected payload:
//   { sku_key?: string, since?: string (ISO), limit?: number }
//
// Secret: PHYND_CAMPAIGN_IMPORT_SECRET (falls back to PHYND_ENGAGEMENT_EVENTS_SECRET).
export async function POST(req: Request) {
  const secret =
    process.env.PHYND_CAMPAIGN_IMPORT_SECRET ?? process.env.PHYND_ENGAGEMENT_EVENTS_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Campaign export secret not configured' }, { status: 503 })
  }

  const parsed = await parseSignedWebhookRequest(req, secret)
  if (!parsed.ok) {
    return parsed.response
  }

  try {
    const payload = parsed.payload
    const skuKey = (payload.sku_key as string | undefined) ?? (payload.skuKey as string | undefined)
    const sinceRaw = payload.since as string | undefined
    const limitRaw = payload.limit as number | string | undefined

    const tenantId = resolveTenantIdForWebhook(req)
    const db = getDb(tenantId)
    const service = new CampaignBuyerSignalService(
      createServiceContext(db, {} as never, {
        userId: 'service:tulana',
        tenantId,
        roles: ['service'],
        scopes: ['campaigns:read'],
        accessToken: '',
      }),
    )

    const since = sinceRaw ? new Date(sinceRaw) : undefined
    const limit =
      typeof limitRaw === 'number' ? limitRaw : limitRaw ? Number.parseInt(limitRaw, 10) : undefined

    const events = await service.listForTulanaExport({
      skuKey,
      since: since && !Number.isNaN(since.getTime()) ? since : undefined,
      limit: limit && !Number.isNaN(limit) ? Math.min(limit, 500) : undefined,
    })

    logger.info({ skuKey, count: events.length }, 'tulana buyer-signal export served')

    return NextResponse.json(
      { events },
      { headers: { 'X-RateLimit-Remaining': String(parsed.remaining) } },
    )
  } catch (error) {
    logger.error({ err: error }, 'buyer-signal export failed')
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}

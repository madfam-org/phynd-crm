import { getCacheManager } from '@/lib/federation/clients'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import type { BotCampaignPayload } from '@phynd/services'
import { createServiceContext } from '@phynd/services'
import { RedditBotService } from '@phynd/services'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    // 0. Fail-closed: reject requests when the shared secret is not configured
    const expectedSecret = process.env.FORTUNA_WEBHOOK_SECRET
    if (!expectedSecret) {
      console.error('FORTUNA_WEBHOOK_SECRET is not configured — refusing to serve webhook')
      return NextResponse.json(
        { error: 'Service unavailable: webhook secret not configured' },
        { status: 503 },
      )
    }

    // 1. Validate authorization secret (Fortuna → Phynd CRM)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: 'Unauthorized webhook trigger' }, { status: 401 })
    }

    // The Fortuna signal payload now additionally carries the master join key
    // (`fortuna_signal_id`, top-level) and the selected owned `profile`
    // {platform, handle, display_name, tone, sku_affinity}. Both are optional on
    // BotCampaignPayload; the bot service persists them as campaign attribution
    // metadata. Legacy Reddit-shaped payloads keep working unchanged.
    const payload = (await req.json()) as BotCampaignPayload

    // 2. Setup internal Service Context to inject into CRM service handlers
    const db = getDb()
    const cache = getCacheManager()
    const mockAuthCtx = {
      userId: 'automation-bot',
      tenantId: DEFAULT_TENANT_ID,
      roles: ['system'],
      scopes: ['*'],
      accessToken: '',
    }

    // We import createServiceContext from '@phynd/services' directly per the monorepo structure
    const ctx = createServiceContext(db, cache, mockAuthCtx)

    // 3. Dispatch payload to Reddit Bot Campaign Service
    const botService = new RedditBotService(ctx)
    const result = await botService.processWebhook(payload)

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    console.error('Campaign Webhook Failed:', error)
    return NextResponse.json(
      { error: 'Internal Server Error processing campaign' },
      { status: 500 },
    )
  }
}

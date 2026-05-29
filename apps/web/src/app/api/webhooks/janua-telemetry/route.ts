import { getCacheManager } from '@/lib/federation/clients'
import { resolveTenantIdForWebhook } from '@/lib/webhooks/engagement-writer'
import { handleWebhook } from '@/lib/webhooks/handler'
import { handleJanuaTelemetryEvent } from '@/lib/webhooks/janua-telemetry-handler'
import { CacheInvalidator } from '@phynd/federation'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const secret = process.env.JANUA_TELEMETRY_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: async (payload) => {
      const cache = getCacheManager()
      const invalidator = new CacheInvalidator(cache)
      const eventType = String(payload.type ?? payload.event ?? 'unknown')
      await invalidator.invalidate('janua-telemetry', eventType, payload)

      const tenantId = resolveTenantIdForWebhook(req)
      await handleJanuaTelemetryEvent(payload, eventType, tenantId)
    },
  })
}

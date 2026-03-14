import { getCacheManager } from '@/lib/federation/clients'
import { handleWebhook } from '@/lib/webhooks/handler'
import { CacheInvalidator } from '@phyne/federation'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const secret = process.env.FORJ_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: async (payload) => {
      const cache = getCacheManager()
      const invalidator = new CacheInvalidator(cache)
      const eventType = (payload.type ?? payload.event ?? 'unknown') as string
      await invalidator.invalidate('forj', eventType, payload)
    },
  })
}

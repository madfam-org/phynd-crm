import { getCacheManager } from '@/lib/federation/clients'
import { CacheInvalidator, WebhookHandler } from '@phyne/federation'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const signature = req.headers.get('x-webhook-signature') ?? ''
  const body = await req.text()
  const secret = process.env.JANUA_TELEMETRY_WEBHOOK_SECRET ?? process.env.JANUA_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  try {
    const cache = getCacheManager()
    const invalidator = new CacheInvalidator(cache)
    const handler = new WebhookHandler(invalidator)
    const result = await handler.handle('janua-telemetry', body, signature, secret)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid webhook signature') {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

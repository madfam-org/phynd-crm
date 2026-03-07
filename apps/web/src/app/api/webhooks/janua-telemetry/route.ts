import { getCacheManager } from '@/lib/federation/clients'
import { getDb } from '@phyne/db'
import { visitorPageViews, visitorSessions } from '@phyne/db/schema'
import { CacheInvalidator, WebhookHandler } from '@phyne/federation'
import { eq } from 'drizzle-orm'
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

    // Persist individual page views from telemetry webhook payload
    await persistPageViews(body)

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid webhook signature') {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

async function persistPageViews(body: string) {
  try {
    const payload = JSON.parse(body) as {
      externalSessionId?: string
      pageViews?: Array<{
        url: string
        title?: string
        duration?: number
        viewedAt?: string
      }>
    }

    if (!payload.externalSessionId || !payload.pageViews?.length) return

    const db = getDb()

    // Look up internal session ID
    const [session] = await db
      .select({ id: visitorSessions.id })
      .from(visitorSessions)
      .where(eq(visitorSessions.externalSessionId, payload.externalSessionId))
      .limit(1)

    if (!session) return

    // Insert page views
    const values = payload.pageViews.map((pv) => ({
      sessionId: session.id,
      url: pv.url,
      title: pv.title,
      duration: pv.duration,
      viewedAt: pv.viewedAt ? new Date(pv.viewedAt) : new Date(),
    }))

    await db.insert(visitorPageViews).values(values)
  } catch {
    // Non-blocking: page view persistence failure should not break webhook processing
  }
}

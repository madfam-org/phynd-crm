import { getCacheManager } from '@/lib/federation/clients'
import { handleWebhook } from '@/lib/webhooks/handler'
import { getDb } from '@phyne/db'
import { visitorPageViews, visitorSessions } from '@phyne/db/schema'
import { CacheInvalidator } from '@phyne/federation'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const secret = process.env.JANUA_TELEMETRY_WEBHOOK_SECRET ?? process.env.JANUA_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: async (payload) => {
      const cache = getCacheManager()
      const invalidator = new CacheInvalidator(cache)
      const eventType = (payload.type ?? payload.event ?? 'unknown') as string
      await invalidator.invalidate('janua-telemetry', eventType, payload)

      await persistPageViews(payload)
    },
  })
}

async function persistPageViews(payload: Record<string, unknown>) {
  try {
    const externalSessionId = payload.externalSessionId as string | undefined
    const pageViews = payload.pageViews as
      | Array<{ url: string; title?: string; duration?: number; viewedAt?: string }>
      | undefined

    if (!externalSessionId || !pageViews?.length) return

    const db = getDb()

    // Look up internal session ID
    const [session] = await db
      .select({ id: visitorSessions.id })
      .from(visitorSessions)
      .where(eq(visitorSessions.externalSessionId, externalSessionId))
      .limit(1)

    if (!session) return

    // Insert page views
    const values = pageViews.map((pv) => ({
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

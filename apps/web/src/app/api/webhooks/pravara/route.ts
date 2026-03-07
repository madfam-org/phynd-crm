import { getCacheManager } from '@/lib/federation/clients'
import { getDb } from '@phyne/db'
import { activities, externalReferences } from '@phyne/db/schema'
import { CacheInvalidator, WebhookHandler } from '@phyne/federation'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const signature = req.headers.get('x-webhook-signature') ?? ''
  const body = await req.text()
  const secret = process.env.PRAVARA_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  try {
    const cache = getCacheManager()
    const invalidator = new CacheInvalidator(cache)
    const handler = new WebhookHandler(invalidator)
    const result = await handler.handle('pravara', body, signature, secret)

    // Create CRM activity for fabrication status changes
    await recordFabricationActivity(body)

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid webhook signature') {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

async function recordFabricationActivity(body: string) {
  try {
    const payload = JSON.parse(body) as {
      event?: string
      orderId?: string
      status?: string
      contactId?: string
      externalId?: string
    }

    if (!payload.event || !payload.status) return

    const db = getDb()

    // Try to find the contact linked to this fabrication order
    let contactId = payload.contactId
    if (!contactId && payload.externalId) {
      const [ref] = await db
        .select({ entityId: externalReferences.entityId })
        .from(externalReferences)
        .where(eq(externalReferences.externalId, payload.externalId))
        .limit(1)
      if (ref) contactId = ref.entityId
    }

    if (!contactId) return

    const statusLabels: Record<string, string> = {
      queued: 'Fabrication order queued',
      in_progress: 'Fabrication started',
      quality_check: 'Quality check in progress',
      shipped: 'Order shipped',
      delivered: 'Order delivered',
      completed: 'Fabrication completed',
      cancelled: 'Fabrication cancelled',
    }

    const title = statusLabels[payload.status] ?? `Fabrication status: ${payload.status}`

    await db.insert(activities).values({
      type: 'fabrication_update',
      title,
      description: `PravaraMES order ${payload.orderId ?? payload.externalId ?? 'unknown'} status changed to "${payload.status}"`,
      entityType: 'contact',
      entityId: contactId,
      ownerId: 'system',
    })
  } catch {
    // Non-blocking: activity creation failure should not break webhook processing
  }
}

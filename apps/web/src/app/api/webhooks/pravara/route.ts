import { getCacheManager } from '@/lib/federation/clients'
import { handleWebhook } from '@/lib/webhooks/handler'
import { getDb } from '@phyne/db'
import { activities, externalReferences } from '@phyne/db/schema'
import { CacheInvalidator } from '@phyne/federation'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const secret = process.env.PRAVARA_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: async (payload) => {
      const cache = getCacheManager()
      const invalidator = new CacheInvalidator(cache)
      const eventType = (payload.type ?? payload.event ?? 'unknown') as string
      await invalidator.invalidate('pravara', eventType, payload)

      await recordFabricationActivity(payload)
    },
  })
}

async function recordFabricationActivity(payload: Record<string, unknown>) {
  try {
    const status = payload.status as string | undefined
    const event = payload.event as string | undefined
    if (!event || !status) return

    const db = getDb()

    // Try to find the contact linked to this fabrication order
    let contactId = payload.contactId as string | undefined
    const externalId = payload.externalId as string | undefined
    if (!contactId && externalId) {
      const [ref] = await db
        .select({ entityId: externalReferences.entityId })
        .from(externalReferences)
        .where(eq(externalReferences.externalId, externalId))
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

    const orderId = (payload.orderId ?? externalId ?? 'unknown') as string
    const title = statusLabels[status] ?? `Fabrication status: ${status}`

    await db.insert(activities).values({
      type: 'fabrication_update',
      title,
      description: `PravaraMES order ${orderId} status changed to "${status}"`,
      entityType: 'contact',
      entityId: contactId,
      ownerId: 'system',
    })
  } catch {
    // Non-blocking: activity creation failure should not break webhook processing
  }
}

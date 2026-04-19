import { getCacheManager } from '@/lib/federation/clients'
import { handleWebhook } from '@/lib/webhooks/handler'
import { getDb } from '@phyne/db'
import { activities, engagements, externalReferences } from '@phyne/db/schema'
import { CacheInvalidator } from '@phyne/federation'
import { createLogger } from '@phyne/logging'
import { EngagementsService } from '@phyne/services'
import { and, eq, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('web:pravara-webhook')

export async function POST(req: Request) {
  const secret = process.env.PRAVARA_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: async (payload) => {
      const cache = getCacheManager()
      const invalidator = new CacheInvalidator(cache)
      const eventType = (payload.type ?? payload.event ?? 'unknown') as string
      await invalidator.invalidate('pravara', eventType, payload)

      await recordFabricationActivity(payload)
      await recordEngagementEvent(payload)
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

// Phase D-5: also feed the client portal timeline. If this Pravara
// order ties to an active engagement for the contact, append an
// engagement_event so the status update shows up in /portal/[id]. No
// engagement linkage? Skip silently — the activity above still lands.
async function recordEngagementEvent(payload: Record<string, unknown>) {
  try {
    const status = payload.status as string | undefined
    const event = payload.event as string | undefined
    if (!event || !status) return

    const db = getDb()

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

    // Pick the first active (non-deleted) engagement for this contact.
    // Future enhancement: Pravara payload carries `engagementId` directly
    // once Cotiza → Pravara dispatch is wired (Phase D-4).
    const explicitEngagementId =
      (payload.engagementId as string | undefined) ??
      (payload.engagement_id as string | undefined)

    let engagementId = explicitEngagementId
    if (!engagementId) {
      const [row] = await db
        .select({ id: engagements.id })
        .from(engagements)
        .where(
          and(
            eq(engagements.contactId, contactId),
            eq(engagements.status, 'active'),
            isNull(engagements.deletedAt),
          ),
        )
        .orderBy(engagements.createdAt)
        .limit(1)
      if (!row) return
      engagementId = row.id
    }

    const orderId = (payload.orderId ?? externalId ?? 'unknown') as string
    const statusMessages: Record<string, string> = {
      queued: 'Fabrication job queued',
      in_progress: 'Fabrication started',
      quality_check: 'Quality check in progress',
      shipped: 'Shipped',
      delivered: 'Delivered',
      completed: 'Fabrication completed',
      cancelled: 'Fabrication cancelled',
    }
    const portalStatusMap: Record<string, string> = {
      queued: 'pending',
      in_progress: 'in_progress',
      quality_check: 'in_progress',
      shipped: 'in_progress',
      delivered: 'completed',
      completed: 'completed',
      cancelled: 'failed',
    }

    const service = new EngagementsService({
      db,
      // biome-ignore lint/suspicious/noExplicitAny: webhook context has no user
      cache: {} as any,
      auth: {
        userId: 'service:pravara',
        tenantId: 'madfam',
        roles: ['service'],
        scopes: ['engagements:write'],
        accessToken: '',
      },
      tenantId: 'madfam',
    })

    const result = await service.recordEvent({
      engagementId,
      source: 'pravara',
      eventType: `pravara:${event}`,
      status: portalStatusMap[status],
      message: statusMessages[status] ?? `Fabrication status: ${status}`,
      metadata: {
        pravara_order_id: orderId,
        pravara_status: status,
        pravara_event: event,
      },
      dedupKey: `pravara:${orderId}:${status}`,
    })

    logger.info(
      { engagementId, orderId, status, deduplicated: result.deduplicated },
      result.deduplicated
        ? 'pravara engagement event deduplicated'
        : 'pravara engagement event recorded',
    )
  } catch (err) {
    logger.warn({ err }, 'pravara → engagement_event failed (non-blocking)')
  }
}

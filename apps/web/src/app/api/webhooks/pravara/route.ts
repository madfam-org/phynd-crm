import { getCacheManager } from '@/lib/federation/clients'
import { handleWebhook } from '@/lib/webhooks/handler'
import { getDb } from '@phynd/db'
import { activities, engagements, externalReferences } from '@phynd/db/schema'
import { CacheInvalidator, NoopCacheManager } from '@phynd/federation'
import { createLogger } from '@phynd/logging'
import { EngagementsService } from '@phynd/services'
import { and, eq, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('web:pravara-webhook')
type Db = ReturnType<typeof getDb>

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
    const contactId = await resolvePravaraContactId(db, payload)

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

    const externalId = payload.externalId as string | undefined
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

async function resolvePravaraContactId(db: Db, payload: Record<string, unknown>) {
  const contactId = payload.contactId as string | undefined
  const externalId = payload.externalId as string | undefined
  if (contactId || !externalId) return contactId

  const [ref] = await db
    .select({ entityId: externalReferences.entityId })
    .from(externalReferences)
    .where(eq(externalReferences.externalId, externalId))
    .limit(1)

  return ref?.entityId
}

async function resolvePravaraEngagementId(
  db: Db,
  payload: Record<string, unknown>,
  contactId: string,
) {
  const explicitEngagementId =
    (payload.engagementId as string | undefined) ?? (payload.engagement_id as string | undefined)
  if (explicitEngagementId) return explicitEngagementId

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

  return row?.id
}

function canonicalPravaraMilestone(status: string) {
  if (status === 'shipped') return 'prototype_shipped'
  if (status === 'delivered') return 'deliverable_received'
  return null
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
    const contactId = await resolvePravaraContactId(db, payload)
    if (!contactId) return

    // Pick the first active (non-deleted) engagement for this contact.
    // Future enhancement: Pravara payload carries `engagementId` directly
    // once Cotiza → Pravara dispatch is wired (Phase D-4).
    const engagementId = await resolvePravaraEngagementId(db, payload, contactId)
    if (!engagementId) {
      return
    }

    const externalId = payload.externalId as string | undefined
    const orderId = (payload.orderId ?? externalId ?? 'unknown') as string
    const statusMessages: Record<string, string> = {
      queued: 'Fabrication job queued',
      in_progress: 'Fabrication started',
      quality_check: 'Quality check in progress',
      shipped: 'Prototype shipped — in transit',
      delivered: 'Prototype delivered',
      completed: 'Fabrication completed',
      cancelled: 'Fabrication cancelled',
    }
    // Status drives the portal's UI badge. `milestone` is reserved for
    // client-visible top-of-timeline events — shipped + delivered are
    // both milestones for a physical build (the client experiences them
    // as discrete "things happened to my prototype" moments).
    const portalStatusMap: Record<string, string> = {
      queued: 'pending',
      in_progress: 'in_progress',
      quality_check: 'in_progress',
      shipped: 'milestone',
      delivered: 'completed',
      completed: 'completed',
      cancelled: 'failed',
    }
    // Canonical event_type: `pravara:shipped` stays the wire format. The
    // cross-source alias `prototype_shipped` is ALSO recorded (idempotent
    // via a second dedup_key) so portal queries that filter on a
    // source-agnostic milestone type work. Rule: any source emitting a
    // physical-deliverable handoff uses `<source>:prototype_shipped` so
    // we can group across Pravara / external fab shops / field install
    // crews uniformly. See docs/ENGAGEMENT_EVENT_TAXONOMY.md.
    const canonicalMilestoneEvent = canonicalPravaraMilestone(status)

    const service = new EngagementsService({
      db,
      cache: new NoopCacheManager(),
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

    // Cross-source milestone alias — source-agnostic filter target for
    // portal queries. Same data, different event_type so timeline
    // filters like "all physical-deliverable handoffs" work across
    // Pravara + future field-install crews without enumerating sources.
    if (canonicalMilestoneEvent) {
      await service.recordEvent({
        engagementId,
        source: 'pravara',
        eventType: `pravara:${canonicalMilestoneEvent}`,
        status: 'milestone',
        message: statusMessages[status] ?? `Fabrication status: ${status}`,
        metadata: {
          pravara_order_id: orderId,
          pravara_status: status,
          pravara_event: event,
          canonical_milestone: canonicalMilestoneEvent,
        },
        // Separate dedup key so the canonical alias is idempotent
        // independent of the raw status event.
        dedupKey: `pravara:${orderId}:milestone:${canonicalMilestoneEvent}`,
      })
    }

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

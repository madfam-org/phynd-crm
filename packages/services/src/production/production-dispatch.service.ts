import type { getDb } from '@phyne/db'
import { engagementEvents, externalReferences, type orders } from '@phyne/db/schema'
import { and, desc, eq } from 'drizzle-orm'

type DispatchTx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]
type OrderRow = typeof orders.$inferSelect

type DeliveryTrack = 'digital_experience' | 'digital_twin' | 'fabrication' | 'fulfillment' | 'kiosk'

export interface ProductionDispatchIntentInput {
  engagementId: string
  order: OrderRow
  paymentEventId: string
  paymentReference: string
  quoteId: string | null
}

export async function recordProductionDispatchIntent(
  tx: DispatchTx,
  input: ProductionDispatchIntentInput,
) {
  const tracks = await resolveDeliveryTracks(tx, input.engagementId)
  if (tracks.length === 0) {
    await recordDispatchBlocked(tx, input)
    return { blocked: true, dispatchedTracks: [] as DeliveryTrack[] }
  }

  const dispatchedTracks: DeliveryTrack[] = []
  for (const track of tracks) {
    const provider = providerForTrack(track)
    const externalId = `${input.order.id}:${track}`
    const exists = await hasDispatchReference(tx, input.order.id, provider, externalId)
    if (exists) continue

    await tx.insert(externalReferences).values({
      entityType: 'order',
      entityId: input.order.id,
      provider,
      externalId,
      externalType: 'production_dispatch',
      metadata: {
        dispatch_status: 'requested',
        engagement_id: input.engagementId,
        order_id: input.order.id,
        payment_event_id: input.paymentEventId,
        payment_reference: input.paymentReference,
        provider,
        quote_id: input.quoteId,
        track,
      },
    })

    await tx.insert(engagementEvents).values({
      engagementId: input.engagementId,
      source: 'system',
      eventType: 'system:production_dispatch_requested',
      status: 'pending',
      message: dispatchMessage(track, input.order.orderNumber),
      metadata: {
        order_id: input.order.id,
        payment_event_id: input.paymentEventId,
        payment_reference: input.paymentReference,
        provider,
        quote_id: input.quoteId,
        track,
      },
      dedupKey: `dispatch:${input.order.id}:${track}:requested`,
    })
    dispatchedTracks.push(track)
  }

  return { blocked: false, dispatchedTracks }
}

async function resolveDeliveryTracks(
  tx: DispatchTx,
  engagementId: string,
): Promise<DeliveryTrack[]> {
  const [intake] = await tx
    .select({ metadata: engagementEvents.metadata })
    .from(engagementEvents)
    .where(
      and(
        eq(engagementEvents.engagementId, engagementId),
        eq(engagementEvents.eventType, 'system:intake_created'),
      ),
    )
    .orderBy(desc(engagementEvents.createdAt))
    .limit(1)

  const metadata = intake?.metadata ?? {}
  const tracks = normalizeDeliveryTracks(metadata.delivery_tracks)
  if (tracks.length > 0) return tracks
  return tracksForProjectKind(metadata.project_kind)
}

function normalizeDeliveryTracks(value: unknown): DeliveryTrack[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<DeliveryTrack>()
  for (const item of value) {
    if (isDeliveryTrack(item)) seen.add(item)
  }
  return [...seen]
}

function tracksForProjectKind(value: unknown): DeliveryTrack[] {
  if (value === 'digital') return ['digital_experience']
  if (value === 'physical') return ['fabrication', 'fulfillment']
  if (value === 'phygital') return ['fabrication', 'digital_twin', 'kiosk']
  return []
}

function isDeliveryTrack(value: unknown): value is DeliveryTrack {
  return (
    value === 'digital_experience' ||
    value === 'digital_twin' ||
    value === 'fabrication' ||
    value === 'fulfillment' ||
    value === 'kiosk'
  )
}

function providerForTrack(track: DeliveryTrack) {
  if (track === 'fabrication' || track === 'fulfillment') return 'pravara'
  return 'selva'
}

async function hasDispatchReference(
  tx: DispatchTx,
  orderId: string,
  provider: string,
  externalId: string,
) {
  const [existing] = await tx
    .select({ id: externalReferences.id })
    .from(externalReferences)
    .where(
      and(
        eq(externalReferences.entityType, 'order'),
        eq(externalReferences.entityId, orderId),
        eq(externalReferences.provider, provider),
        eq(externalReferences.externalId, externalId),
        eq(externalReferences.externalType, 'production_dispatch'),
      ),
    )
    .limit(1)
  return Boolean(existing)
}

async function recordDispatchBlocked(tx: DispatchTx, input: ProductionDispatchIntentInput) {
  const dedupKey = `dispatch:${input.order.id}:blocked`
  const alreadyRecorded = await hasEngagementEvent(tx, input.engagementId, dedupKey)
  if (alreadyRecorded) return

  await tx.insert(engagementEvents).values({
    engagementId: input.engagementId,
    source: 'system',
    eventType: 'system:production_dispatch_blocked',
    status: 'blocked',
    message: `Production dispatch for order ${input.order.orderNumber} needs delivery track review`,
    metadata: {
      order_id: input.order.id,
      payment_event_id: input.paymentEventId,
      payment_reference: input.paymentReference,
      quote_id: input.quoteId,
      reason: 'missing_delivery_tracks',
    },
    dedupKey,
  })
}

function dispatchMessage(track: DeliveryTrack, orderNumber: string) {
  const label = track.replace(/_/g, ' ')
  return `Production dispatch requested for ${label} on order ${orderNumber}`
}

async function hasEngagementEvent(tx: DispatchTx, engagementId: string, dedupKey: string) {
  const [existing] = await tx
    .select({ id: engagementEvents.id })
    .from(engagementEvents)
    .where(
      and(eq(engagementEvents.engagementId, engagementId), eq(engagementEvents.dedupKey, dedupKey)),
    )
    .limit(1)
  return Boolean(existing)
}

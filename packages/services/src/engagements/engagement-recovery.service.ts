import { engagementEvents, engagements, orders } from '@phynd/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { NotFoundError, ValidationError } from '../errors'
import {
  type DhanamPaymentReconciliationInput,
  reconcileDhanamPayment,
} from '../payments/payment-reconciliation.service'
import { recordProductionDispatchIntent } from '../production/production-dispatch.service'

type RecoveryTx = Parameters<Parameters<ServiceContext['db']['transaction']>[0]>[0]

export type DeliveryTrack =
  | 'digital_experience'
  | 'digital_twin'
  | 'fabrication'
  | 'fulfillment'
  | 'kiosk'

const BLOCKED_EVENT_PREFIXES = [
  'system:payment_unmatched',
  'system:payment_failed_unmatched',
  'system:payment_refunded_unmatched',
  'system:payment_disputed_unmatched',
  'system:payment_cancelled_unmatched',
  'system:production_dispatch_blocked',
] as const

export class EngagementRecoveryService {
  constructor(private readonly ctx: ServiceContext) {}

  async listBlockedEvents(engagementId: string) {
    await assertEngagementExists(this.ctx.db, engagementId)

    const rows = await this.ctx.db
      .select()
      .from(engagementEvents)
      .where(
        and(
          eq(engagementEvents.engagementId, engagementId),
          eq(engagementEvents.status, 'blocked'),
        ),
      )
      .orderBy(desc(engagementEvents.createdAt))
      .limit(50)

    return rows.filter((row) => isRecoverableBlockedEvent(row.eventType))
  }

  async linkPaymentToOrder(input: { blockedEventId: string; orderId: string }) {
    return this.ctx.db.transaction(async (tx) => {
      const event = await getBlockedEvent(tx, input.blockedEventId)
      if (!isPaymentUnmatchedEvent(event.eventType)) {
        throw new ValidationError('Event is not a recoverable payment mismatch')
      }

      const order = await assertOrderForEngagement(tx, event.engagementId, input.orderId)
      if (!order.contactId) {
        throw new ValidationError('Order is missing a linked contact')
      }
      const reconciliation = buildReconciliationInput(event, order.id, order.contactId)

      const result = await reconcileDhanamPayment(tx, reconciliation)
      if (result.status !== 'reconciled') {
        throw new ValidationError(
          `Payment could not be reconciled (${result.status}). Confirm the order and payment amount.`,
        )
      }

      await markEventResolved(tx, event.id, {
        action: 'link_payment_to_order',
        order_id: order.id,
        reconciled_by: this.ctx.auth.userId,
      })

      return { eventId: event.id, orderId: order.id, reconciliation: result }
    })
  }

  async retryProductionDispatch(input: {
    blockedEventId: string
    deliveryTracks?: DeliveryTrack[]
  }) {
    return this.ctx.db.transaction(async (tx) => {
      const event = await getBlockedEvent(tx, input.blockedEventId)
      if (event.eventType !== 'system:production_dispatch_blocked') {
        throw new ValidationError('Event is not a production dispatch blocker')
      }

      const metadata = eventMetadata(event)
      const orderId = stringMeta(metadata, 'order_id')
      if (!orderId) {
        throw new ValidationError('Blocked dispatch event is missing order_id metadata')
      }

      const order = await assertOrderForEngagement(tx, event.engagementId, orderId)

      if (input.deliveryTracks && input.deliveryTracks.length > 0) {
        await tx.insert(engagementEvents).values({
          engagementId: event.engagementId,
          source: 'system',
          eventType: 'system:delivery_tracks_configured',
          status: 'completed',
          message: `Operator configured delivery tracks: ${input.deliveryTracks.join(', ')}`,
          metadata: {
            delivery_tracks: input.deliveryTracks,
            configured_by: this.ctx.auth.userId,
            source_blocked_event_id: event.id,
          },
          dedupKey: `delivery_tracks:${event.engagementId}:${event.id}`,
        })
      }

      const paymentEventId = stringMeta(metadata, 'payment_event_id') ?? event.id
      const paymentReference =
        stringMeta(metadata, 'payment_reference') ??
        stringMeta(metadata, 'external_payment_id') ??
        paymentEventId

      const dispatch = await recordProductionDispatchIntent(tx, {
        engagementId: event.engagementId,
        order,
        paymentEventId,
        paymentReference,
        quoteId: order.quoteId ?? stringMeta(metadata, 'quote_id'),
      })

      if (dispatch.blocked) {
        throw new ValidationError(
          'Production dispatch is still blocked. Configure delivery tracks and retry.',
        )
      }

      await markEventResolved(tx, event.id, {
        action: 'retry_production_dispatch',
        dispatched_tracks: dispatch.dispatchedTracks,
        resolved_by: this.ctx.auth.userId,
      })

      return {
        eventId: event.id,
        orderId: order.id,
        dispatchedTracks: dispatch.dispatchedTracks,
      }
    })
  }

  async resolveBlockedEvent(input: { blockedEventId: string; note?: string }) {
    return this.ctx.db.transaction(async (tx) => {
      const event = await getBlockedEvent(tx, input.blockedEventId)
      await markEventResolved(tx, event.id, {
        action: 'manual_resolve',
        note: input.note ?? null,
        resolved_by: this.ctx.auth.userId,
      })
      return { eventId: event.id, status: 'completed' as const }
    })
  }
}

async function assertEngagementExists(db: ServiceContext['db'], engagementId: string) {
  const [row] = await db
    .select({ id: engagements.id })
    .from(engagements)
    .where(and(eq(engagements.id, engagementId), isNull(engagements.deletedAt)))
    .limit(1)
  if (!row) throw new NotFoundError('Engagement', engagementId)
}

async function getBlockedEvent(tx: RecoveryTx, eventId: string) {
  const [event] = await tx
    .select()
    .from(engagementEvents)
    .where(and(eq(engagementEvents.id, eventId), eq(engagementEvents.status, 'blocked')))
    .limit(1)

  if (!event) {
    throw new NotFoundError('Blocked engagement event', eventId)
  }
  if (!isRecoverableBlockedEvent(event.eventType)) {
    throw new ValidationError(`Event type ${event.eventType} is not operator-recoverable`)
  }

  return event
}

async function assertOrderForEngagement(tx: RecoveryTx, engagementId: string, orderId: string) {
  const [engagement] = await tx
    .select()
    .from(engagements)
    .where(and(eq(engagements.id, engagementId), isNull(engagements.deletedAt)))
    .limit(1)
  if (!engagement) throw new NotFoundError('Engagement', engagementId)

  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
    .limit(1)
  if (!order) throw new NotFoundError('Order', orderId)

  const linked =
    (engagement.opportunityId && order.opportunityId === engagement.opportunityId) ||
    order.contactId === engagement.contactId
  if (!linked) {
    throw new ValidationError('Order does not belong to this engagement')
  }

  return order
}

function buildReconciliationInput(
  event: typeof engagementEvents.$inferSelect,
  orderId: string,
  contactId: string,
): DhanamPaymentReconciliationInput {
  const metadata = eventMetadata(event)
  const amountMinor = numberMeta(metadata, 'amount_minor')
  if (amountMinor == null) {
    throw new ValidationError('Blocked payment event is missing amount_minor metadata')
  }

  const eventId = stringMeta(metadata, 'event_id') ?? event.id

  return {
    amountMinor,
    contactId,
    currency: stringMeta(metadata, 'currency'),
    engagementId: event.engagementId,
    eventId,
    eventType: stringMeta(metadata, 'event_type') ?? event.eventType,
    externalPaymentId: stringMeta(metadata, 'external_payment_id') ?? eventId,
    orderId,
    quoteId: stringMeta(metadata, 'requested_quote_id') ?? stringMeta(metadata, 'quote_id'),
  }
}

async function markEventResolved(
  tx: RecoveryTx,
  eventId: string,
  resolution: Record<string, unknown>,
) {
  const [existing] = await tx
    .select()
    .from(engagementEvents)
    .where(eq(engagementEvents.id, eventId))
    .limit(1)
  if (!existing) return

  await tx
    .update(engagementEvents)
    .set({
      status: 'completed',
      message: existing.message
        ? `${existing.message} (resolved by operator)`
        : 'Resolved by operator',
      metadata: {
        ...(existing.metadata ?? {}),
        resolution: {
          ...resolution,
          resolved_at: new Date().toISOString(),
        },
      },
    })
    .where(eq(engagementEvents.id, eventId))
}

function isRecoverableBlockedEvent(eventType: string) {
  return (
    BLOCKED_EVENT_PREFIXES.includes(eventType as (typeof BLOCKED_EVENT_PREFIXES)[number]) ||
    (eventType.startsWith('system:payment_') && eventType.endsWith('_unmatched'))
  )
}

function isPaymentUnmatchedEvent(eventType: string) {
  return eventType === 'system:payment_unmatched' || eventType.endsWith('_unmatched')
}

function stringMeta(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberMeta(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function eventMetadata(event: typeof engagementEvents.$inferSelect) {
  return (event.metadata ?? {}) as Record<string, unknown>
}

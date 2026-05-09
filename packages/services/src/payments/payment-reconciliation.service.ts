import type { getDb } from '@phynd/db'
import { engagementEvents, engagements, externalReferences, orders } from '@phynd/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { recordProductionDispatchIntent } from '../production/production-dispatch.service'

type PaymentTx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]
type OrderRow = typeof orders.$inferSelect

export interface DhanamPaymentReconciliationInput {
  amountMinor: number | null
  contactId: string
  currency: string | null
  engagementId?: string | null
  eventId: string
  eventType: string
  externalPaymentId?: string | null
  occurredAt?: Date
  orderId?: string | null
  quoteId?: string | null
}

export type DhanamPaymentLifecycle = 'paid' | 'failed' | 'refunded' | 'disputed' | 'cancelled'

export interface DhanamPaymentLifecycleInput extends DhanamPaymentReconciliationInput {
  lifecycle: DhanamPaymentLifecycle
}

export interface PaymentReconciliationResult {
  engagementId: string | null
  orderId: string | null
  paidAmount: string | null
  paymentStatus: string | null
  quoteId: string | null
  status: 'ignored' | 'lifecycle_adjusted' | 'reconciled' | 'unmatched'
}

export async function reconcileDhanamPayment(
  tx: PaymentTx,
  input: DhanamPaymentReconciliationInput,
): Promise<PaymentReconciliationResult> {
  if (input.amountMinor == null) {
    return emptyResult('ignored')
  }

  const order = await resolveOrder(tx, input)
  const engagementId = input.engagementId ?? (await findEngagementId(tx, input, order))

  if (!order) {
    if (engagementId) {
      await recordUnmatchedPaymentEvent(tx, engagementId, input)
    }
    return { ...emptyResult('unmatched'), engagementId }
  }

  const paidAmount = calculatePaidAmount(order, input.amountMinor)
  const paymentStatus = calculatePaymentStatus(order, paidAmount)
  const occurredAt = input.occurredAt ?? new Date()
  const externalPaymentId = input.externalPaymentId ?? input.eventId
  const alreadyReconciled = await hasExistingOrderReference(
    tx,
    order.id,
    externalPaymentId,
    'payment',
  )
  if (alreadyReconciled) {
    return {
      engagementId,
      orderId: order.id,
      paidAmount: order.paidAmount,
      paymentStatus: order.paymentStatus,
      quoteId: order.quoteId ?? input.quoteId ?? null,
      status: 'reconciled',
    }
  }

  await tx
    .update(orders)
    .set({
      externalPaymentId,
      paidAmount,
      paidAt: occurredAt,
      paymentProvider: 'dhanam',
      paymentStatus,
      status: order.status === 'pending' ? 'confirmed' : order.status,
    })
    .where(eq(orders.id, order.id))

  await tx.insert(externalReferences).values({
    entityType: 'order',
    entityId: order.id,
    provider: 'dhanam',
    externalId: externalPaymentId,
    externalType: 'payment',
    metadata: {
      amount_minor: input.amountMinor,
      currency: input.currency,
      event_id: input.eventId,
      event_type: input.eventType,
      quote_id: order.quoteId ?? input.quoteId ?? null,
    },
  })

  if (engagementId) {
    await recordReconciledPaymentEvent(tx, engagementId, order, input, paidAmount, paymentStatus)
    await maybeRecordPaidProductionDispatch(tx, engagementId, order, input, paymentStatus)
  }

  return {
    engagementId,
    orderId: order.id,
    paidAmount,
    paymentStatus,
    quoteId: order.quoteId ?? input.quoteId ?? null,
    status: 'reconciled',
  }
}

export async function reconcileDhanamPaymentLifecycle(
  tx: PaymentTx,
  input: DhanamPaymentLifecycleInput,
): Promise<PaymentReconciliationResult> {
  if (input.lifecycle === 'paid') return reconcileDhanamPayment(tx, input)

  const order = await resolveOrder(tx, input)
  const engagementId = input.engagementId ?? (await findEngagementId(tx, input, order))

  if (!order) {
    if (engagementId) {
      await recordUnmatchedLifecycleEvent(tx, engagementId, input)
    }
    return { ...emptyResult('unmatched'), engagementId }
  }

  const externalPaymentId = input.externalPaymentId ?? input.eventId
  const externalType = `payment_${input.lifecycle}`
  const alreadyAdjusted = await hasExistingOrderReference(
    tx,
    order.id,
    externalPaymentId,
    externalType,
  )
  if (alreadyAdjusted) {
    return {
      engagementId,
      orderId: order.id,
      paidAmount: order.paidAmount,
      paymentStatus: order.paymentStatus,
      quoteId: order.quoteId ?? input.quoteId ?? null,
      status: 'lifecycle_adjusted',
    }
  }

  const patch = buildLifecycleOrderPatch(order, input)
  await tx.update(orders).set(patch).where(eq(orders.id, order.id))

  await tx.insert(externalReferences).values({
    entityType: 'order',
    entityId: order.id,
    provider: 'dhanam',
    externalId: externalPaymentId,
    externalType,
    metadata: {
      amount_minor: input.amountMinor,
      currency: input.currency,
      event_id: input.eventId,
      event_type: input.eventType,
      lifecycle: input.lifecycle,
      quote_id: order.quoteId ?? input.quoteId ?? null,
    },
  })

  if (engagementId) {
    await recordLifecycleEvent(tx, engagementId, order, input, patch)
  }

  return {
    engagementId,
    orderId: order.id,
    paidAmount: patch.paidAmount ?? order.paidAmount,
    paymentStatus: patch.paymentStatus ?? order.paymentStatus,
    quoteId: order.quoteId ?? input.quoteId ?? null,
    status: 'lifecycle_adjusted',
  }
}

async function hasExistingOrderReference(
  tx: PaymentTx,
  orderId: string,
  externalPaymentId: string,
  externalType: string,
) {
  const [existing] = await tx
    .select({ id: externalReferences.id })
    .from(externalReferences)
    .where(
      and(
        eq(externalReferences.entityType, 'order'),
        eq(externalReferences.entityId, orderId),
        eq(externalReferences.provider, 'dhanam'),
        eq(externalReferences.externalId, externalPaymentId),
        eq(externalReferences.externalType, externalType),
      ),
    )
    .limit(1)
  return Boolean(existing)
}

async function maybeRecordPaidProductionDispatch(
  tx: PaymentTx,
  engagementId: string,
  order: OrderRow,
  input: DhanamPaymentReconciliationInput,
  paymentStatus: string,
) {
  if (paymentStatus !== 'paid') return
  await recordProductionDispatchIntent(tx, {
    engagementId,
    order,
    paymentEventId: input.eventId,
    paymentReference: input.externalPaymentId ?? input.eventId,
    quoteId: order.quoteId ?? input.quoteId ?? null,
  })
}

async function resolveOrder(
  tx: PaymentTx,
  input: DhanamPaymentReconciliationInput,
): Promise<OrderRow | null> {
  return (
    (await findOrderById(tx, input.orderId)) ??
    (await findOrderByQuote(tx, input)) ??
    (await findOrderByEngagement(tx, input)) ??
    (await findOrderByContact(tx, input.contactId, input))
  )
}

async function findOrderById(tx: PaymentTx, orderId: string | null | undefined) {
  if (!orderId) return null
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
    .limit(1)
  return order ?? null
}

async function findOrderByQuote(tx: PaymentTx, input: DhanamPaymentReconciliationInput) {
  if (!input.quoteId) return null
  return selectBestOrder(await findOrders(tx, orders.quoteId, input.quoteId), input)
}

async function findOrderByEngagement(tx: PaymentTx, input: DhanamPaymentReconciliationInput) {
  if (!input.engagementId) return null
  const engagement = await findEngagement(tx, input.engagementId)
  const byOpportunity = engagement?.opportunityId
    ? await findOrderByContact(tx, engagement.opportunityId, input, orders.opportunityId)
    : null
  return byOpportunity ?? findOrderByContact(tx, engagement?.contactId ?? null, input)
}

async function findOrderByContact(
  tx: PaymentTx,
  contactId: string | null,
  input: DhanamPaymentReconciliationInput,
  column: typeof orders.opportunityId | typeof orders.contactId = orders.contactId,
) {
  if (!contactId) return null
  return selectBestOrder(await findOrders(tx, column, contactId), input)
}

async function findOrders(
  tx: PaymentTx,
  column: typeof orders.quoteId | typeof orders.opportunityId | typeof orders.contactId,
  value: string,
) {
  return tx
    .select()
    .from(orders)
    .where(and(eq(column, value), isNull(orders.deletedAt)))
    .orderBy(desc(orders.createdAt))
    .limit(10)
}

function selectBestOrder(
  candidates: OrderRow[],
  input: DhanamPaymentReconciliationInput,
): OrderRow | null {
  if (candidates.length === 0) return null
  const matching = candidates.find(
    (order) => amountMatches(order, input.amountMinor) && currencyMatches(order, input.currency),
  )
  return matching ?? candidates[0] ?? null
}

async function findEngagement(tx: PaymentTx, engagementId: string) {
  const [engagement] = await tx
    .select({
      contactId: engagements.contactId,
      id: engagements.id,
      opportunityId: engagements.opportunityId,
    })
    .from(engagements)
    .where(and(eq(engagements.id, engagementId), isNull(engagements.deletedAt)))
    .limit(1)
  return engagement ?? null
}

async function findEngagementId(
  tx: PaymentTx,
  input: DhanamPaymentReconciliationInput,
  order: OrderRow | null,
): Promise<string | null> {
  if (order?.opportunityId) {
    const [engagement] = await tx
      .select({ id: engagements.id })
      .from(engagements)
      .where(and(eq(engagements.opportunityId, order.opportunityId), isNull(engagements.deletedAt)))
      .limit(1)
    if (engagement?.id) return engagement.id
  }

  const [engagement] = await tx
    .select({ id: engagements.id })
    .from(engagements)
    .where(
      and(
        eq(engagements.contactId, order?.contactId ?? input.contactId),
        eq(engagements.status, 'active'),
        isNull(engagements.deletedAt),
      ),
    )
    .limit(1)
  return engagement?.id ?? null
}

async function recordReconciledPaymentEvent(
  tx: PaymentTx,
  engagementId: string,
  order: OrderRow,
  input: DhanamPaymentReconciliationInput,
  paidAmount: string,
  paymentStatus: string,
) {
  await tx.insert(engagementEvents).values({
    engagementId,
    source: 'system',
    eventType: 'system:payment_reconciled',
    status: 'milestone',
    message: `Payment reconciled to order ${order.orderNumber}`,
    metadata: {
      amount_minor: input.amountMinor,
      currency: input.currency,
      event_id: input.eventId,
      event_type: input.eventType,
      external_payment_id: input.externalPaymentId ?? input.eventId,
      order_id: order.id,
      paid_amount: paidAmount,
      payment_status: paymentStatus,
      quote_id: order.quoteId ?? input.quoteId ?? null,
    },
    dedupKey: `payment:${input.eventId}:reconciled`,
  })
}

async function recordUnmatchedPaymentEvent(
  tx: PaymentTx,
  engagementId: string,
  input: DhanamPaymentReconciliationInput,
) {
  await tx.insert(engagementEvents).values({
    engagementId,
    source: 'system',
    eventType: 'system:payment_unmatched',
    status: 'blocked',
    message: 'Payment received but no matching order was found',
    metadata: {
      amount_minor: input.amountMinor,
      currency: input.currency,
      event_id: input.eventId,
      event_type: input.eventType,
      external_payment_id: input.externalPaymentId ?? input.eventId,
      requested_order_id: input.orderId ?? null,
      requested_quote_id: input.quoteId ?? null,
    },
    dedupKey: `payment:${input.eventId}:unmatched`,
  })
}

async function recordUnmatchedLifecycleEvent(
  tx: PaymentTx,
  engagementId: string,
  input: DhanamPaymentLifecycleInput,
) {
  await tx.insert(engagementEvents).values({
    engagementId,
    source: 'system',
    eventType: `system:payment_${input.lifecycle}_unmatched`,
    status: 'blocked',
    message: `Payment ${input.lifecycle} event received but no matching order was found`,
    metadata: {
      amount_minor: input.amountMinor,
      currency: input.currency,
      event_id: input.eventId,
      event_type: input.eventType,
      external_payment_id: input.externalPaymentId ?? input.eventId,
      lifecycle: input.lifecycle,
      requested_order_id: input.orderId ?? null,
      requested_quote_id: input.quoteId ?? null,
    },
    dedupKey: `payment:${input.eventId}:${input.lifecycle}:unmatched`,
  })
}

function buildLifecycleOrderPatch(order: OrderRow, input: DhanamPaymentLifecycleInput) {
  const patch: Partial<typeof orders.$inferInsert> = {
    externalPaymentId: input.externalPaymentId ?? input.eventId,
    paymentProvider: 'dhanam',
  }

  if (input.lifecycle === 'failed') {
    patch.paymentStatus = order.paymentStatus === 'paid' ? order.paymentStatus : 'failed'
    return patch
  }

  if (input.lifecycle === 'disputed') {
    patch.paymentStatus = 'disputed'
    return patch
  }

  if (input.lifecycle === 'cancelled') {
    patch.paymentStatus = 'cancelled'
    if (order.status === 'pending' || order.status === 'confirmed') {
      patch.status = 'cancelled'
    }
    return patch
  }

  const paidMinor = majorToMinor(order.paidAmount) ?? 0
  const refundMinor = input.amountMinor ?? paidMinor
  const nextPaidMinor = Math.max(paidMinor - refundMinor, 0)
  patch.paidAmount = (nextPaidMinor / 100).toFixed(2)
  patch.paymentStatus = nextPaidMinor > 0 ? 'partial_refund' : 'refunded'
  return patch
}

async function recordLifecycleEvent(
  tx: PaymentTx,
  engagementId: string,
  order: OrderRow,
  input: DhanamPaymentLifecycleInput,
  patch: Partial<typeof orders.$inferInsert>,
) {
  const event = lifecycleEventCopy(order, input)
  await tx.insert(engagementEvents).values({
    engagementId,
    source: 'system',
    eventType: `system:payment_${input.lifecycle}`,
    status: event.status,
    message: event.message,
    metadata: {
      amount_minor: input.amountMinor,
      currency: input.currency,
      event_id: input.eventId,
      event_type: input.eventType,
      external_payment_id: input.externalPaymentId ?? input.eventId,
      lifecycle: input.lifecycle,
      order_id: order.id,
      paid_amount: patch.paidAmount ?? order.paidAmount,
      payment_status: patch.paymentStatus ?? order.paymentStatus,
      quote_id: order.quoteId ?? input.quoteId ?? null,
    },
    dedupKey: `payment:${input.eventId}:${input.lifecycle}`,
  })
}

function lifecycleEventCopy(order: OrderRow, input: DhanamPaymentLifecycleInput) {
  if (input.lifecycle === 'failed') {
    return {
      status: 'failed',
      message: `Payment failed for order ${order.orderNumber}`,
    }
  }
  if (input.lifecycle === 'refunded') {
    return {
      status: 'blocked',
      message: `Payment refunded for order ${order.orderNumber}`,
    }
  }
  if (input.lifecycle === 'disputed') {
    return {
      status: 'blocked',
      message: `Payment disputed for order ${order.orderNumber}`,
    }
  }
  return {
    status: 'failed',
    message: `Payment cancelled for order ${order.orderNumber}`,
  }
}

function calculatePaidAmount(order: OrderRow, amountMinor: number) {
  const existingMinor = majorToMinor(order.paidAmount) ?? 0
  return ((existingMinor + amountMinor) / 100).toFixed(2)
}

function calculatePaymentStatus(order: OrderRow, paidAmount: string) {
  const paidMinor = majorToMinor(paidAmount) ?? 0
  const totalMinor = majorToMinor(order.totalAmount)
  if (totalMinor == null) return 'paid'
  if (paidMinor >= totalMinor) return 'paid'
  return paidMinor > 0 ? 'partial' : 'unpaid'
}

function amountMatches(order: OrderRow, amountMinor: number | null) {
  const totalMinor = majorToMinor(order.totalAmount)
  if (amountMinor == null || totalMinor == null) return true
  return amountMinor >= totalMinor
}

function currencyMatches(order: OrderRow, currency: string | null) {
  if (!currency) return true
  return order.currency.toUpperCase() === currency.toUpperCase()
}

function majorToMinor(value: string | null | undefined) {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100)
}

function emptyResult(status: PaymentReconciliationResult['status']): PaymentReconciliationResult {
  return {
    engagementId: null,
    orderId: null,
    paidAmount: null,
    paymentStatus: null,
    quoteId: null,
    status,
  }
}

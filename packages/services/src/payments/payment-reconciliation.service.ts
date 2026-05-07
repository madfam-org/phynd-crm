import type { getDb } from '@phyne/db'
import { engagementEvents, engagements, externalReferences, orders } from '@phyne/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'

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

export interface PaymentReconciliationResult {
  engagementId: string | null
  orderId: string | null
  paidAmount: string | null
  paymentStatus: string | null
  quoteId: string | null
  status: 'ignored' | 'reconciled' | 'unmatched'
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
  const alreadyReconciled = await hasExistingPaymentReference(tx, order.id, externalPaymentId)
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

async function hasExistingPaymentReference(
  tx: PaymentTx,
  orderId: string,
  externalPaymentId: string,
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
      ),
    )
    .limit(1)
  return Boolean(existing)
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

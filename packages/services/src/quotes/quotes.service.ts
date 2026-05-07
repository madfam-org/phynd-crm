import {
  conversions,
  engagementEvents,
  engagements,
  opportunities,
  orders,
  quotes,
} from '@phyne/db/schema'
import type { PaginatedResult, PaginationInput } from '@phyne/types/crm'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { NotificationsService } from '../notifications/notifications.service'

type QuoteTx = Parameters<Parameters<ServiceContext['db']['transaction']>[0]>[0]
type QuoteRow = typeof quotes.$inferSelect
type OrderRow = typeof orders.$inferSelect

export interface AcceptQuoteInput {
  createOrder?: boolean
  estimatedCompletion?: Date
  orderNumber?: string
  orderStatus?: 'confirmed' | 'in_production'
  source?: 'api' | 'cotiza' | 'crm' | 'portal'
}

export interface AcceptQuoteResult {
  engagementId: string | null
  order: OrderRow | null
  quote: QuoteRow
}

export class QuotesService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(
    pagination?: PaginationInput,
    filters?: { ownerId?: string },
  ): Promise<PaginatedResult<typeof quotes.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [isNull(quotes.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(quotes.id, pagination.cursor))
    }
    if (filters?.ownerId) {
      conditions.push(eq(quotes.ownerId, filters.ownerId))
    }

    const rows = await this.ctx.db
      .select()
      .from(quotes)
      .where(and(...conditions))
      .orderBy(quotes.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async listByOpportunityId(
    opportunityId: string,
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<typeof quotes.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [eq(quotes.opportunityId, opportunityId), isNull(quotes.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(quotes.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(quotes)
      .where(and(...conditions))
      .orderBy(quotes.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async listByContactId(
    contactId: string,
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<typeof quotes.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [eq(quotes.contactId, contactId), isNull(quotes.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(quotes.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(quotes)
      .where(and(...conditions))
      .orderBy(quotes.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async getById(id: string) {
    const [quote] = await this.ctx.db
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, id), isNull(quotes.deletedAt)))
    return quote ?? null
  }

  async create(data: {
    quoteNumber: string
    opportunityId?: string
    contactId?: string
    totalAmount?: string
    currency?: string
    validUntil?: Date
    ownerId?: string
  }) {
    const [quote] = await this.ctx.db.insert(quotes).values(data).returning()
    return quote ?? null
  }

  async update(
    id: string,
    data: Partial<{
      quoteNumber: string
      totalAmount: string
      currency: string
      status: string
      validUntil: Date
      ownerId: string
    }>,
  ) {
    let previousOwnerId: string | null = null
    if (data.ownerId) {
      const existing = await this.getById(id)
      previousOwnerId = existing?.ownerId ?? null
    }

    const [quote] = await this.ctx.db.update(quotes).set(data).where(eq(quotes.id, id)).returning()

    if (quote && data.ownerId && data.ownerId !== previousOwnerId) {
      try {
        const notificationsService = new NotificationsService(this.ctx)
        await notificationsService.create({
          userId: data.ownerId,
          type: 'owner_assignment',
          title: 'New quote assigned to you',
          message: `You have been assigned quote: ${quote.quoteNumber}`,
          entityType: 'quote',
          entityId: id,
        })
      } catch {
        // Non-blocking: notification failure should not break quote operations
      }
    }

    return quote ?? null
  }

  async accept(id: string, input: AcceptQuoteInput = {}): Promise<AcceptQuoteResult | null> {
    return this.ctx.db.transaction((tx) =>
      acceptQuoteInTransaction(tx, id, input, this.ctx.auth.userId),
    )
  }

  async delete(id: string) {
    const [deleted] = await this.ctx.db
      .update(quotes)
      .set({ deletedAt: new Date() })
      .where(eq(quotes.id, id))
      .returning()
    return deleted ?? null
  }
}

async function acceptQuoteInTransaction(
  tx: QuoteTx,
  id: string,
  input: AcceptQuoteInput,
  acceptedBy: string | undefined,
): Promise<AcceptQuoteResult | null> {
  const current = await getActiveQuote(tx, id)
  if (!current) return null
  if (!canAcceptQuote(current.status)) {
    throw new Error(`Quote ${current.quoteNumber} cannot be accepted from status ${current.status}`)
  }

  const alreadyAccepted = current.status === 'accepted'
  const quote = await updateQuoteToAccepted(tx, current)
  const order = await resolveAcceptedQuoteOrder(tx, quote, input)

  if (!alreadyAccepted) {
    await markOpportunityWon(tx, quote)
    await recordQuoteAcceptedConversion(tx, quote)
  }

  const engagement = await findEngagementForQuote(tx, quote)
  if (engagement && !alreadyAccepted) {
    await recordQuoteApprovedMilestone(tx, engagement.id, quote, order, input, acceptedBy)
  }

  return { engagementId: engagement?.id ?? null, order, quote }
}

async function getActiveQuote(tx: QuoteTx, id: string) {
  const [quote] = await tx
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, id), isNull(quotes.deletedAt)))
    .limit(1)
  return quote ?? null
}

async function updateQuoteToAccepted(tx: QuoteTx, current: QuoteRow) {
  const [acceptedQuote] = await tx
    .update(quotes)
    .set({ status: 'accepted' })
    .where(eq(quotes.id, current.id))
    .returning()
  return acceptedQuote ?? { ...current, status: 'accepted' }
}

async function resolveAcceptedQuoteOrder(tx: QuoteTx, quote: QuoteRow, input: AcceptQuoteInput) {
  const [existing] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.quoteId, quote.id), isNull(orders.deletedAt)))
    .limit(1)

  if (existing) {
    return maybeConfirmExistingOrder(tx, existing, input)
  }

  if (input.createOrder === false) return null

  const [order] = await tx
    .insert(orders)
    .values({
      orderNumber: input.orderNumber ?? buildOrderNumber(quote.quoteNumber),
      opportunityId: quote.opportunityId,
      quoteId: quote.id,
      contactId: quote.contactId,
      status: input.orderStatus ?? 'confirmed',
      totalAmount: quote.totalAmount,
      currency: quote.currency,
      estimatedCompletion: input.estimatedCompletion,
      ownerId: quote.ownerId,
    })
    .returning()
  return order ?? null
}

async function recordQuoteApprovedMilestone(
  tx: QuoteTx,
  engagementId: string,
  quote: QuoteRow,
  order: OrderRow | null,
  input: AcceptQuoteInput,
  acceptedBy: string | undefined,
) {
  const source = input.source === 'cotiza' ? 'cotiza' : 'system'
  await tx.insert(engagementEvents).values({
    engagementId,
    source,
    eventType: `${source}:quote_approved`,
    status: 'milestone',
    message: `Quote ${quote.quoteNumber} accepted`,
    metadata: {
      accepted_by: acceptedBy,
      acceptance_source: input.source ?? 'crm',
      contact_id: quote.contactId,
      currency: quote.currency,
      order_id: order?.id ?? null,
      opportunity_id: quote.opportunityId,
      quote_id: quote.id,
      quote_number: quote.quoteNumber,
      total_amount: quote.totalAmount,
    },
    dedupKey: `quote:${quote.id}:accepted`,
  })
}

async function maybeConfirmExistingOrder(tx: QuoteTx, order: OrderRow, input: AcceptQuoteInput) {
  const patch: Partial<typeof orders.$inferInsert> = {}
  if (input.orderStatus) {
    patch.status = input.orderStatus
  } else if (order.status === 'pending') {
    patch.status = 'confirmed'
  }
  if (input.estimatedCompletion) patch.estimatedCompletion = input.estimatedCompletion

  if (Object.keys(patch).length === 0) return order

  const [updated] = await tx.update(orders).set(patch).where(eq(orders.id, order.id)).returning()
  return updated ?? order
}

async function markOpportunityWon(tx: QuoteTx, quote: QuoteRow) {
  if (!quote.opportunityId) return

  const [opportunity] = await tx
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.id, quote.opportunityId), isNull(opportunities.deletedAt)))
    .limit(1)
  if (!opportunity || opportunity.status === 'won') return

  await tx
    .update(opportunities)
    .set({ status: 'won', probability: 100 })
    .where(eq(opportunities.id, quote.opportunityId))

  await tx
    .insert(conversions)
    .values({
      type: 'opportunity_to_won',
      contactId: quote.contactId,
      opportunityId: quote.opportunityId,
      value: quote.totalAmount ?? opportunity.value,
    })
    .onConflictDoNothing()
}

async function recordQuoteAcceptedConversion(tx: QuoteTx, quote: QuoteRow) {
  await tx
    .insert(conversions)
    .values({
      type: 'quote_accepted',
      contactId: quote.contactId,
      opportunityId: quote.opportunityId,
      value: quote.totalAmount,
      metadata: {
        currency: quote.currency,
        quote_id: quote.id,
        quote_number: quote.quoteNumber,
      },
    })
    .onConflictDoNothing()
}

async function findEngagementForQuote(tx: QuoteTx, quote: QuoteRow) {
  if (quote.opportunityId) {
    const [engagement] = await tx
      .select()
      .from(engagements)
      .where(and(eq(engagements.opportunityId, quote.opportunityId), isNull(engagements.deletedAt)))
      .limit(1)
    if (engagement) return engagement
  }

  if (!quote.contactId) return null

  const [engagement] = await tx
    .select()
    .from(engagements)
    .where(
      and(
        eq(engagements.contactId, quote.contactId),
        eq(engagements.status, 'active'),
        isNull(engagements.deletedAt),
      ),
    )
    .limit(1)
  return engagement ?? null
}

function buildOrderNumber(quoteNumber: string) {
  const normalized = quoteNumber.trim()
  if (/^Q[-_]/i.test(normalized)) return normalized.replace(/^Q/i, 'ORD')
  return `ORD-${normalized}`
}

function canAcceptQuote(status: string) {
  return status === 'draft' || status === 'sent' || status === 'accepted'
}

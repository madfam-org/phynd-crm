import { createHmac } from 'node:crypto'
import type { getDb } from '@phyne/db'
import {
  contacts,
  engagementArtifacts,
  engagementEvents,
  engagements,
  externalReferences,
  type orders,
  type quotes,
} from '@phyne/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { FederationError, NotFoundError, ValidationError } from '../errors'
import { type AcceptQuoteInput, QuotesService } from '../quotes/quotes.service'

type CheckoutTx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]
type CheckoutDb = ReturnType<typeof getDb>
type QuoteRow = typeof quotes.$inferSelect
type ContactRow = typeof contacts.$inferSelect
type EngagementRow = typeof engagements.$inferSelect

type FetchFn = typeof fetch

export interface CreateDhanamCheckoutInput {
  cancelUrl?: string
  engagementId?: string | null
  quoteId: string
  reuseExistingCheckout?: boolean
  source?: 'api' | 'crm' | 'portal'
  successUrl?: string
}

export interface DhanamCheckoutResult {
  amountMinor: number
  cancelUrl: string
  checkoutUrl: string
  currency: string
  engagementId: string | null
  expiresAt: Date | null
  orderId: string | null
  quoteId: string
  reused: boolean
  sessionId: string
  successUrl: string
}

interface DhanamCheckoutDeps {
  appUrl?: string
  dhanamApiUrl?: string
  fetch?: FetchFn
  signingSecret?: string
}

interface CheckoutReference {
  externalId: string
  metadata: Record<string, unknown> | null
}

interface AcceptedQuoteContext {
  amountDueMinor: number
  contact: ContactRow
  engagement: EngagementRow | null
  orderId: string | null
  quote: QuoteRow
}

export class DhanamCheckoutService {
  private readonly appUrl: string
  private readonly dhanamApiUrl: string | undefined
  private readonly fetchFn: FetchFn
  private readonly signingSecret: string | undefined

  constructor(
    private readonly ctx: ServiceContext,
    deps: DhanamCheckoutDeps = {},
  ) {
    this.appUrl = normalizeBaseUrl(deps.appUrl ?? process.env.NEXT_PUBLIC_APP_URL)
    this.dhanamApiUrl = deps.dhanamApiUrl ?? process.env.DHANAM_API_URL
    this.fetchFn = deps.fetch ?? globalThis.fetch
    this.signingSecret = deps.signingSecret ?? process.env.DHANAM_WEBHOOK_SECRET
  }

  async createForQuote(input: CreateDhanamCheckoutInput): Promise<DhanamCheckoutResult> {
    const accepted = await this.acceptQuote(input)
    const context = await this.resolveAcceptedContext(input, accepted)
    const existing =
      input.reuseExistingCheckout === false
        ? null
        : await findReusableCheckout(this.ctx.db, context.quote.id, context.amountDueMinor)
    const urls = buildCheckoutUrls(this.appUrl, context.engagement?.id ?? input.engagementId, input)

    if (existing) {
      return buildResultFromReference(existing, context, urls)
    }

    const request = buildCheckoutRequest(context, urls)
    const response = await this.createDhanamSession(request.payload)
    await recordCheckoutArtifacts(this.ctx.db, context, response, request.payload, urls)

    return {
      amountMinor: request.payload.data.amount_minor,
      cancelUrl: urls.cancelUrl,
      checkoutUrl: response.checkoutUrl,
      currency: request.payload.data.currency,
      engagementId: context.engagement?.id ?? null,
      expiresAt: response.expiresAt,
      orderId: context.orderId,
      quoteId: context.quote.id,
      reused: false,
      sessionId: response.sessionId,
      successUrl: urls.successUrl,
    }
  }

  private async acceptQuote(input: CreateDhanamCheckoutInput) {
    const source = input.source ?? 'crm'
    const acceptInput = {
      createOrder: true,
      source,
    } satisfies AcceptQuoteInput
    const accepted = await new QuotesService(this.ctx).accept(input.quoteId, acceptInput)
    if (!accepted) {
      throw new NotFoundError('Quote', input.quoteId)
    }
    return accepted
  }

  private async resolveAcceptedContext(
    input: CreateDhanamCheckoutInput,
    accepted: Awaited<ReturnType<QuotesService['accept']>>,
  ): Promise<AcceptedQuoteContext> {
    if (!accepted) throw new NotFoundError('Quote', input.quoteId)
    const quote = accepted.quote
    if (!quote.contactId) {
      throw new ValidationError('Quote must be linked to a contact before checkout')
    }

    const [contact, engagement] = await Promise.all([
      findContact(this.ctx.db, quote.contactId),
      resolveEngagement(this.ctx.db, quote, input.engagementId ?? accepted.engagementId),
    ])

    if (!contact) {
      throw new NotFoundError('Contact', quote.contactId)
    }
    if (!contact.email) {
      throw new ValidationError('Client email is required before checkout')
    }
    validateQuoteAmount(quote)
    const amountDueMinor = calculateAmountDueMinor(quote, accepted.order)
    if (amountDueMinor <= 0) {
      throw new ValidationError('Quote has no remaining balance before checkout')
    }

    return {
      amountDueMinor,
      contact,
      engagement,
      orderId: accepted.order?.id ?? null,
      quote,
    }
  }

  private async createDhanamSession(payload: DhanamCheckoutRequest): Promise<DhanamSession> {
    if (!this.dhanamApiUrl) {
      throw new FederationError('dhanam', 'DHANAM_API_URL is not configured')
    }
    if (!this.signingSecret) {
      throw new FederationError('dhanam', 'DHANAM_WEBHOOK_SECRET is not configured')
    }

    const body = JSON.stringify(payload)
    const signature = createHmac('sha256', this.signingSecret).update(body).digest('hex')
    const response = await this.fetchFn(joinUrl(this.dhanamApiUrl, '/v1/checkout/sessions'), {
      body,
      headers: {
        'Content-Type': 'application/json',
        'X-PhyneCRM-Signature': `sha256=${signature}`,
      },
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new FederationError(
        'dhanam',
        `checkout creation failed with status ${response.status}`,
        {
          body: text,
          status: response.status,
        },
      )
    }

    return parseDhanamSession(await response.json())
  }
}

interface CheckoutUrls {
  cancelUrl: string
  successUrl: string
}

interface DhanamCheckoutRequest {
  data: {
    amount_minor: number
    cancel_url: string
    contact: {
      company: string | null
      email: string
      id: string
      name: string
      phone: string | null
    }
    currency: string
    engagement_id: string | null
    metadata: Record<string, string | null>
    order_id: string | null
    quote_id: string
    quote_number: string
    success_url: string
  }
  type: 'quote.checkout.requested'
}

interface DhanamSession {
  checkoutUrl: string
  expiresAt: Date | null
  sessionId: string
}

function buildCheckoutUrls(
  appUrl: string,
  engagementId: string | null | undefined,
  input: CreateDhanamCheckoutInput,
): CheckoutUrls {
  const portalPath = engagementId ? `/portal/${engagementId}` : '/portal/expired'
  return {
    cancelUrl: input.cancelUrl ?? `${appUrl}${portalPath}?checkout=cancelled`,
    successUrl: input.successUrl ?? `${appUrl}${portalPath}?checkout=success`,
  }
}

function buildCheckoutRequest(context: AcceptedQuoteContext, urls: CheckoutUrls) {
  const currency = normalizeCurrency(context.quote.currency)

  return {
    payload: {
      type: 'quote.checkout.requested',
      data: {
        amount_minor: context.amountDueMinor,
        cancel_url: urls.cancelUrl,
        contact: {
          company: context.contact.company,
          email: context.contact.email as string,
          id: context.contact.id,
          name: context.contact.name,
          phone: context.contact.phone,
        },
        currency,
        engagement_id: context.engagement?.id ?? null,
        metadata: {
          contact_id: context.contact.id,
          engagement_id: context.engagement?.id ?? null,
          order_id: context.orderId,
          quote_id: context.quote.id,
          quote_number: context.quote.quoteNumber,
        },
        order_id: context.orderId,
        quote_id: context.quote.id,
        quote_number: context.quote.quoteNumber,
        success_url: urls.successUrl,
      },
    } satisfies DhanamCheckoutRequest,
  }
}

async function findReusableCheckout(
  tx: CheckoutDb | CheckoutTx,
  quoteId: string,
  amountDueMinor: number,
): Promise<CheckoutReference | null> {
  const [existing] = await tx
    .select({
      externalId: externalReferences.externalId,
      metadata: externalReferences.metadata,
    })
    .from(externalReferences)
    .where(
      and(
        eq(externalReferences.entityType, 'quote'),
        eq(externalReferences.entityId, quoteId),
        eq(externalReferences.provider, 'dhanam'),
        eq(externalReferences.externalType, 'checkout_session'),
      ),
    )
    .orderBy(desc(externalReferences.createdAt))
    .limit(1)

  if (!existing) return null
  const metadata = asRecord(existing.metadata)
  if (!metadata?.checkout_url) return null
  if (!checkoutAmountMatches(metadata, amountDueMinor)) return null
  if (!checkoutStatusReusable(metadata)) return null
  if (!checkoutStillOpen(metadata)) return null
  return { externalId: existing.externalId, metadata }
}

function buildResultFromReference(
  existing: CheckoutReference,
  context: AcceptedQuoteContext,
  urls: CheckoutUrls,
): DhanamCheckoutResult {
  const checkoutUrl = pickString(existing.metadata?.checkout_url)
  if (!checkoutUrl) {
    throw new ValidationError('Stored Dhanam checkout reference is missing checkout_url')
  }

  return {
    amountMinor:
      pickNumber(existing.metadata?.amount_minor) ?? amountToMinor(context.quote.totalAmount),
    cancelUrl: urls.cancelUrl,
    checkoutUrl,
    currency: pickString(existing.metadata?.currency) ?? normalizeCurrency(context.quote.currency),
    engagementId: context.engagement?.id ?? pickString(existing.metadata?.engagement_id) ?? null,
    expiresAt: parseDate(pickString(existing.metadata?.expires_at)),
    orderId: context.orderId ?? pickString(existing.metadata?.order_id),
    quoteId: context.quote.id,
    reused: true,
    sessionId: pickString(existing.metadata?.session_id) ?? existing.externalId,
    successUrl: urls.successUrl,
  }
}

async function recordCheckoutArtifacts(
  db: CheckoutDb,
  context: AcceptedQuoteContext,
  session: DhanamSession,
  payload: DhanamCheckoutRequest,
  urls: CheckoutUrls,
) {
  await db.transaction(async (tx) => {
    await tx.insert(externalReferences).values({
      entityType: 'quote',
      entityId: context.quote.id,
      provider: 'dhanam',
      externalId: session.sessionId,
      externalType: 'checkout_session',
      metadata: {
        amount_minor: payload.data.amount_minor,
        cancel_url: urls.cancelUrl,
        checkout_url: session.checkoutUrl,
        currency: payload.data.currency,
        engagement_id: context.engagement?.id ?? null,
        expires_at: session.expiresAt?.toISOString() ?? null,
        original_quote_amount_minor: amountToMinor(context.quote.totalAmount),
        order_id: context.orderId,
        quote_id: context.quote.id,
        quote_number: context.quote.quoteNumber,
        remaining_balance_minor: context.amountDueMinor,
        session_id: session.sessionId,
        status: 'open',
        success_url: urls.successUrl,
      },
    })

    if (!context.engagement) return

    await tx.insert(engagementArtifacts).values({
      engagementId: context.engagement.id,
      type: 'invoice',
      entityType: 'quote',
      entityId: context.quote.id,
      url: session.checkoutUrl,
      title: `Payment for Quote ${context.quote.quoteNumber}`,
      metadata: {
        amount_minor: payload.data.amount_minor,
        checkout_session_id: session.sessionId,
        currency: payload.data.currency,
        order_id: context.orderId,
        provider: 'dhanam',
        quote_id: context.quote.id,
        remaining_balance_minor: context.amountDueMinor,
      },
    })

    await tx.insert(engagementEvents).values({
      engagementId: context.engagement.id,
      source: 'system',
      eventType: 'system:checkout_created',
      status: 'pending',
      message: `Payment checkout created for Quote ${context.quote.quoteNumber}`,
      metadata: {
        amount_minor: payload.data.amount_minor,
        checkout_session_id: session.sessionId,
        currency: payload.data.currency,
        order_id: context.orderId,
        provider: 'dhanam',
        quote_id: context.quote.id,
        remaining_balance_minor: context.amountDueMinor,
      },
      dedupKey: `checkout:${session.sessionId}:created`,
    })
  })
}

async function findContact(tx: CheckoutDb | CheckoutTx, contactId: string) {
  const [contact] = await tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)))
    .limit(1)
  return contact ?? null
}

async function resolveEngagement(
  tx: CheckoutDb | CheckoutTx,
  quote: QuoteRow,
  engagementId: string | null | undefined,
) {
  if (engagementId) {
    const [engagement] = await tx
      .select()
      .from(engagements)
      .where(and(eq(engagements.id, engagementId), isNull(engagements.deletedAt)))
      .limit(1)
    if (!engagement) throw new NotFoundError('Engagement', engagementId)
    validateEngagementForQuote(engagement, quote)
    return engagement
  }

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
    .orderBy(desc(engagements.createdAt))
    .limit(1)
  return engagement ?? null
}

function validateEngagementForQuote(engagement: EngagementRow, quote: QuoteRow) {
  if (quote.opportunityId && engagement.opportunityId === quote.opportunityId) return
  if (quote.contactId && engagement.contactId === quote.contactId) return
  throw new ValidationError('Engagement does not match quote contact or opportunity')
}

function validateQuoteAmount(quote: QuoteRow) {
  if (amountToMinor(quote.totalAmount) <= 0) {
    throw new ValidationError('Quote total amount must be greater than zero before checkout')
  }
}

function calculateAmountDueMinor(quote: QuoteRow, order: typeof orders.$inferSelect | null) {
  const totalMinor = amountToMinor(quote.totalAmount)
  const paidMinor = amountToMinor(order?.paidAmount ?? null)
  return Math.max(totalMinor - paidMinor, 0)
}

function checkoutAmountMatches(metadata: Record<string, unknown>, amountDueMinor: number) {
  const checkoutAmount = pickNumber(metadata.amount_minor)
  return checkoutAmount == null || checkoutAmount === amountDueMinor
}

function checkoutStatusReusable(metadata: Record<string, unknown>) {
  const status = pickString(metadata.status)
  return !status || status === 'open' || status === 'pending'
}

function checkoutStillOpen(metadata: Record<string, unknown>) {
  const expiresAt = parseDate(pickString(metadata.expires_at))
  return !expiresAt || expiresAt.getTime() > Date.now()
}

function parseDhanamSession(body: unknown): DhanamSession {
  const data = asRecord(body)
  if (!data) throw new FederationError('dhanam', 'checkout response was not an object')

  const checkoutUrl = pickString(
    data.checkout_url,
    data.checkoutUrl,
    data.payment_url,
    data.paymentUrl,
    data.url,
  )
  const sessionId = pickString(data.session_id, data.sessionId, data.id)
  if (!checkoutUrl || !sessionId) {
    throw new FederationError('dhanam', 'checkout response missing checkout URL or session ID')
  }

  return {
    checkoutUrl,
    expiresAt: parseDate(pickString(data.expires_at, data.expiresAt)),
    sessionId,
  }
}

function amountToMinor(amount: string | null) {
  if (!amount) return 0
  const parsed = Number.parseFloat(amount)
  if (!Number.isFinite(parsed)) return 0
  return Math.round(parsed * 100)
}

function normalizeCurrency(currency: string | null) {
  return (currency || 'USD').trim().toUpperCase()
}

function normalizeBaseUrl(url: string | undefined) {
  return (url || 'http://localhost:3000').replace(/\/+$/, '')
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function pickNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

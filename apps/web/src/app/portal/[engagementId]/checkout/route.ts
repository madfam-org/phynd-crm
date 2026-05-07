import { readAndVerifyPortalSession } from '@/lib/portal/session'
import { getDb } from '@phyne/db'
import { contacts, engagements, quotes } from '@phyne/db/schema'
import { createLogger } from '@phyne/logging'
import { DhanamCheckoutService } from '@phyne/services/payments/dhanam-checkout'
import { and, eq, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('web:portal:checkout')

type RouteContext = {
  params: Promise<{ engagementId: string }>
}

export async function POST(req: Request, context: RouteContext) {
  const { engagementId } = await context.params
  const session = await readAndVerifyPortalSession()
  if (!session || session.engagementId !== engagementId) {
    return redirectToExpired(req, 'no-session')
  }

  const db = getDb()
  const engagement = await verifyPortalEngagement(db, engagementId, session.email)
  if (!engagement) {
    return redirectToExpired(req, 'email-mismatch')
  }

  const quoteId = await readQuoteId(req)
  if (!quoteId) {
    return redirectToPortal(req, engagementId, { checkout_error: 'missing_quote' })
  }

  const quote = await findPortalQuote(db, engagement, quoteId)
  if (!quote) {
    return redirectToPortal(req, engagementId, { checkout_error: 'quote_not_found' })
  }

  try {
    const checkout = await new DhanamCheckoutService({
      auth: {
        userId: `portal:${session.januaUserId}`,
        tenantId: 'madfam',
        roles: ['portal'],
        scopes: ['quotes:accept', 'payments:write'],
        accessToken: session.accessToken,
      },
      // biome-ignore lint/suspicious/noExplicitAny: portal route does not need cache access
      cache: {} as any,
      db,
      tenantId: 'madfam',
    }).createForQuote({
      cancelUrl: buildPortalUrl(req, engagementId, { checkout: 'cancelled' }).toString(),
      engagementId,
      quoteId: quote.id,
      source: 'portal',
      successUrl: buildPortalUrl(req, engagementId, { checkout: 'success' }).toString(),
    })

    return NextResponse.redirect(checkout.checkoutUrl, 303)
  } catch (err) {
    logger.error({ err, engagementId, quoteId }, 'portal checkout creation failed')
    return redirectToPortal(req, engagementId, { checkout_error: 'checkout_failed' })
  }
}

async function readQuoteId(req: Request) {
  const form = await req.formData().catch(() => null)
  const value = form?.get('quoteId')
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function verifyPortalEngagement(
  db: ReturnType<typeof getDb>,
  engagementId: string,
  email: string,
) {
  const [row] = await db
    .select({
      contactEmail: contacts.email,
      contactId: engagements.contactId,
      id: engagements.id,
      opportunityId: engagements.opportunityId,
    })
    .from(engagements)
    .innerJoin(contacts, eq(engagements.contactId, contacts.id))
    .where(and(eq(engagements.id, engagementId), isNull(engagements.deletedAt)))
    .limit(1)

  if (!row) return null
  if (row.contactEmail?.toLowerCase().trim() !== email.toLowerCase().trim()) return null
  return row
}

async function findPortalQuote(
  db: ReturnType<typeof getDb>,
  engagement: { contactId: string; opportunityId: string | null },
  quoteId: string,
) {
  const [quote] = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), isNull(quotes.deletedAt)))
    .limit(1)

  if (!quote) return null
  if (quote.opportunityId && quote.opportunityId === engagement.opportunityId) return quote
  if (quote.contactId && quote.contactId === engagement.contactId) return quote
  return null
}

function redirectToExpired(req: Request, reason: string) {
  const url = new URL('/portal/expired', req.url)
  url.searchParams.set('reason', reason)
  return NextResponse.redirect(url, 303)
}

function redirectToPortal(req: Request, engagementId: string, params: Record<string, string>) {
  return NextResponse.redirect(buildPortalUrl(req, engagementId, params), 303)
}

function buildPortalUrl(req: Request, engagementId: string, params: Record<string, string>) {
  const url = new URL(`/portal/${engagementId}`, req.url)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url
}

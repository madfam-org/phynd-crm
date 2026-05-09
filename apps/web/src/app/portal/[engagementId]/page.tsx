import { readAndVerifyPortalSession } from '@/lib/portal/session'
import { getDb } from '@phynd/db'
import { contacts, engagements, orders, quotes } from '@phynd/db/schema'
import { EngagementsService } from '@phynd/services'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import { paymentStateMessage, portalPaymentAction } from './payment-state'

// Server-rendered portal page. Gates on the phynd-portal-session cookie
// (set by /portal/verify after the Janua magic-link exchange) and
// double-checks that the session email matches the engagement's contact
// email so a stale/forged cookie can't access a different engagement.
//
// No tRPC here — we read from @phynd/db directly because the client has
// no Janua staff session and can't mint a protectedProcedure context.

type PageProps = {
  params: Promise<{ engagementId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function EngagementPortalPage({ params, searchParams }: PageProps) {
  const { engagementId } = await params
  const query = await searchParams
  const checkoutError = firstQueryValue(query?.checkout_error)
  const checkoutNotice = firstQueryValue(query?.checkout)
  const session = await readAndVerifyPortalSession()

  if (!session || session.engagementId !== engagementId) {
    redirect('/portal/expired?reason=no-session')
  }

  const db = getDb()
  const [row] = await db
    .select({
      engagement: engagements,
      contactEmail: contacts.email,
      contactName: contacts.name,
      contactCompany: contacts.company,
    })
    .from(engagements)
    .innerJoin(contacts, eq(engagements.contactId, contacts.id))
    .where(and(eq(engagements.id, engagementId), isNull(engagements.deletedAt)))
    .limit(1)

  if (!row) {
    notFound()
  }

  if (row.contactEmail?.toLowerCase().trim() !== session.email.toLowerCase().trim()) {
    redirect('/portal/expired?reason=email-mismatch')
  }

  const service = new EngagementsService({
    db,
    // biome-ignore lint/suspicious/noExplicitAny: portal page reads directly
    cache: {} as any,
    auth: {
      userId: `portal:${session.januaUserId}`,
      tenantId: 'madfam',
      roles: ['portal'],
      scopes: ['engagements:read'],
      accessToken: session.accessToken,
    },
    tenantId: 'madfam',
  })

  const [timeline, artifacts, portalQuotes] = await Promise.all([
    service.getTimeline(engagementId, 50),
    service.listArtifacts(engagementId),
    findPortalQuotes(db, row.engagement),
  ])
  const quoteCards = await buildQuoteCards(db, portalQuotes)

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-10 border-b border-slate-200 pb-6 dark:border-slate-800">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {row.contactCompany ?? 'Your MADFAM project'}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {row.engagement.projectName}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Hello {row.contactName ?? row.contactEmail}, here's the live status of your engagement.
          </p>
          <StatusBadge status={row.engagement.status} />
        </header>

        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
            Quote and payment
          </h2>
          {quoteCards.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Your quote is being prepared. We'll publish it here when it is ready for review.
            </p>
          ) : (
            <ul className="space-y-3">
              {quoteCards.map((card) => (
                <li
                  key={card.quote.id}
                  className="rounded-md border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        Quote {card.quote.quoteNumber}
                      </p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {formatMoney(card.quote.totalAmount, card.quote.currency)}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <StatusPill label={card.quote.status} />
                        {card.order && <StatusPill label={card.order.paymentStatus} />}
                      </div>
                      {card.order && (
                        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                          Order {card.order.orderNumber} · {card.order.status.replace(/_/g, ' ')}
                        </p>
                      )}
                    </div>
                    <QuoteAction
                      checkoutError={checkoutError}
                      checkoutNotice={checkoutNotice}
                      currency={card.quote.currency}
                      engagementId={engagementId}
                      paidAmount={card.order?.paidAmount ?? null}
                      paymentStatus={card.order?.paymentStatus ?? 'unpaid'}
                      quoteId={card.quote.id}
                      quoteStatus={card.quote.status}
                      totalAmount={card.quote.totalAmount}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
            Project files
          </h2>
          {artifacts.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No files yet. We'll update this page as proposals, invoices, and deliverables arrive.
            </p>
          ) : (
            <ul className="space-y-2">
              {artifacts.map((a) => (
                <li
                  key={a.id}
                  className="rounded-md border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {a.title ?? formatArtifactType(a.type)}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {formatArtifactType(a.type)} · {a.createdAt.toLocaleDateString()}
                      </p>
                    </div>
                    {a.url && (
                      <a
                        className="shrink-0 rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
                        href={a.url}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        Open
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
            Activity
          </h2>
          {timeline.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No activity yet. Updates from our team will appear here as your project progresses.
            </p>
          ) : (
            <ol className="space-y-3">
              {timeline.map((entry) => (
                <li
                  key={entry.id}
                  className="flex gap-3 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                >
                  <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-900 dark:text-slate-100">
                      {timelineMessage(entry)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {entry.createdAt.toLocaleString()}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  )
}

type PortalQuote = typeof quotes.$inferSelect

async function findPortalQuotes(
  db: ReturnType<typeof getDb>,
  engagement: typeof engagements.$inferSelect,
) {
  const rows = engagement.opportunityId
    ? await db
        .select()
        .from(quotes)
        .where(and(eq(quotes.opportunityId, engagement.opportunityId), isNull(quotes.deletedAt)))
        .orderBy(desc(quotes.createdAt))
        .limit(10)
    : await db
        .select()
        .from(quotes)
        .where(and(eq(quotes.contactId, engagement.contactId), isNull(quotes.deletedAt)))
        .orderBy(desc(quotes.createdAt))
        .limit(10)

  return rows.filter((quote) => ['draft', 'sent', 'accepted'].includes(quote.status))
}

async function buildQuoteCards(db: ReturnType<typeof getDb>, portalQuotes: PortalQuote[]) {
  return Promise.all(
    portalQuotes.map(async (quote) => {
      const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.quoteId, quote.id), isNull(orders.deletedAt)))
        .orderBy(desc(orders.createdAt))
        .limit(1)
      return { order: order ?? null, quote }
    }),
  )
}

function QuoteAction({
  checkoutError,
  checkoutNotice,
  currency,
  engagementId,
  paidAmount,
  paymentStatus,
  quoteId,
  quoteStatus,
  totalAmount,
}: {
  checkoutError?: string | null
  checkoutNotice?: string | null
  currency: string
  engagementId: string
  paidAmount?: string | null
  paymentStatus: string
  quoteId: string
  quoteStatus: string
  totalAmount?: string | null
}) {
  const message = paymentStateMessage({
    checkoutError,
    checkoutNotice,
    currency,
    paidAmount,
    paymentStatus,
    quoteStatus,
    totalAmount,
  })
  const action = portalPaymentAction({ paymentStatus, quoteStatus })

  if (action === 'paid') {
    return (
      <div className="max-w-xs text-left sm:text-right">
        <span className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white">
          Paid
        </span>
        {message && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{message}</p>}
      </div>
    )
  }

  if (action === 'accept_and_pay' || action === 'pay_now' || action === 'retry') {
    return (
      <div className="max-w-xs text-left sm:text-right">
        <form action={`/portal/${engagementId}/checkout`} method="post">
          <input name="quoteId" type="hidden" value={quoteId} />
          {action === 'retry' && <input name="checkoutMode" type="hidden" value="fresh" />}
          <button
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
            type="submit"
          >
            {actionLabel(action)}
          </button>
        </form>
        {message && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{message}</p>}
      </div>
    )
  }

  return (
    <div className="max-w-xs text-left sm:text-right">
      <span className="rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        In review
      </span>
      {message && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{message}</p>}
    </div>
  )
}

function actionLabel(action: ReturnType<typeof portalPaymentAction>) {
  if (action === 'accept_and_pay') return 'Accept and pay'
  if (action === 'retry') return 'Retry payment'
  return 'Pay now'
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-700 dark:bg-slate-800 dark:text-slate-200">
      {label.replace(/_/g, ' ')}
    </span>
  )
}

function formatMoney(amount: string | null, currency: string) {
  if (!amount) return currency
  return new Intl.NumberFormat('en-US', {
    currency,
    style: 'currency',
  }).format(Number(amount))
}

function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ')
  const tone =
    status === 'active'
      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100'
      : status === 'completed'
        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-200'
        : status === 'paused'
          ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100'
          : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-200'
  return (
    <span
      className={`mt-3 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ${tone}`}
    >
      {label}
    </span>
  )
}

function formatArtifactType(type: string): string {
  const map: Record<string, string> = {
    quote: 'Quote',
    signed_proposal: 'Signed proposal',
    invoice: 'Invoice',
    deliverable: 'Deliverable',
    nft_receipt: 'NFT receipt',
  }
  return map[type] ?? type.replace(/_/g, ' ')
}

function firstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

// biome-ignore lint/suspicious/noExplicitAny: discriminated union on entry.kind, cast for readability
function timelineMessage(entry: any): string {
  if (entry.kind === 'event') {
    return entry.message ?? `${entry.source}: ${entry.eventType}`
  }
  if (entry.kind === 'activity') {
    return entry.title
  }
  if (entry.kind === 'stage_transition') {
    return 'Status changed'
  }
  return 'Update'
}

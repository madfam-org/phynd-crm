import { paymentStateMessage, portalPaymentAction } from '@/app/portal/[engagementId]/payment-state'
import {
  type TimelineVisualTone,
  timelineEventTone,
} from '@/lib/engagements/timeline-presentations'
import {
  type PortalCopy,
  formatPortalDate,
  formatPortalDateTime,
  formatPortalMoney,
  labelFor,
} from '@/lib/portal/copy'
import type { PortalQuoteCard } from '@/lib/portal/quotes'
import type { ClientTimelineEntry } from '@phynd/services'
import { PortalEmpty, PortalSection } from './portal-items'

// Server-rendered quote, file and activity sections of the client portal.

interface PortalArtifact {
  id: string
  type: string
  title: string | null
  url: string | null
  createdAt: Date
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
      {label}
    </span>
  )
}

const BUTTON =
  'rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900'

function QuoteAction({
  card,
  copy,
  engagementId,
  checkoutError,
  checkoutNotice,
}: {
  card: PortalQuoteCard
  copy: PortalCopy
  engagementId: string
  checkoutError: string | null
  checkoutNotice: string | null
}) {
  const state = {
    checkoutError,
    checkoutNotice,
    currency: card.quote.currency,
    paidAmount: card.order?.paidAmount ?? null,
    paymentStatus: card.order?.paymentStatus ?? 'unpaid',
    quoteStatus: card.quote.status,
    totalAmount: card.quote.totalAmount,
  }
  const message = paymentStateMessage(state, copy)
  const action = portalPaymentAction(state)
  const note = message && (
    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{message}</p>
  )

  if (action === 'paid') {
    return (
      <div className="max-w-xs text-left sm:text-right">
        <span className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white">
          {copy.actions.paid}
        </span>
        {note}
      </div>
    )
  }
  if (action === 'accept_and_pay' || action === 'pay_now' || action === 'retry') {
    return (
      <div className="max-w-xs text-left sm:text-right">
        <form action={`/portal/${engagementId}/checkout`} method="post">
          <input name="quoteId" type="hidden" value={card.quote.id} />
          {action === 'retry' && <input name="checkoutMode" type="hidden" value="fresh" />}
          <button className={BUTTON} type="submit">
            {copy.actions[action]}
          </button>
        </form>
        {note}
      </div>
    )
  }
  return (
    <div className="max-w-xs text-left sm:text-right">
      <span className="rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {copy.actions.awaiting_review}
      </span>
      {note}
    </div>
  )
}

export function PortalQuotes(props: {
  cards: PortalQuoteCard[]
  copy: PortalCopy
  engagementId: string
  checkoutError: string | null
  checkoutNotice: string | null
}) {
  const { cards, copy } = props
  return (
    <PortalSection title={copy.sections.quotes}>
      {cards.length === 0 ? (
        <PortalEmpty>{copy.quotesEmpty}</PortalEmpty>
      ) : (
        <ul className="space-y-3">
          {cards.map((card) => (
            <li
              className="rounded-md border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              key={card.quote.id}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {copy.quote(card.quote.quoteNumber)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {formatPortalMoney(card.quote.totalAmount, card.quote.currency)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <StatusPill label={labelFor(copy.quoteStatus, card.quote.status)} />
                    {card.order && (
                      <StatusPill label={labelFor(copy.paymentStatus, card.order.paymentStatus)} />
                    )}
                  </div>
                  {card.order && (
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                      {copy.order(
                        card.order.orderNumber,
                        labelFor(copy.orderStatus, card.order.status),
                      )}
                    </p>
                  )}
                </div>
                <QuoteAction {...props} card={card} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </PortalSection>
  )
}

export function PortalFiles({
  artifacts,
  acceptedIds,
  copy,
  engagementId,
}: {
  artifacts: PortalArtifact[]
  acceptedIds: Set<string>
  copy: PortalCopy
  engagementId: string
}) {
  return (
    <PortalSection title={copy.sections.files}>
      {artifacts.length === 0 ? (
        <PortalEmpty>{copy.filesEmpty}</PortalEmpty>
      ) : (
        <ul className="space-y-2">
          {artifacts.map((a) => (
            <li
              className="rounded-md border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              key={a.id}
            >
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {a.title ?? labelFor(copy.artifactType, a.type)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {labelFor(copy.artifactType, a.type)} · {formatPortalDate(a.createdAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {a.type === 'deliverable' && acceptedIds.has(a.id) && (
                    <span className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white">
                      {copy.accepted}
                    </span>
                  )}
                  {a.type === 'deliverable' && !acceptedIds.has(a.id) && (
                    <form action={`/portal/${engagementId}/signoff`} method="post">
                      <input name="artifactId" type="hidden" value={a.id} />
                      <button
                        className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        type="submit"
                      >
                        {copy.acceptDeliverable}
                      </button>
                    </form>
                  )}
                  {a.url && (
                    <a
                      className={`shrink-0 ${BUTTON}`}
                      href={a.url}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {copy.open}
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PortalSection>
  )
}

function activityStyles(tone: TimelineVisualTone) {
  if (tone === 'milestone') {
    return {
      dotClass: 'bg-violet-500',
      cardClass: 'border-violet-200 bg-violet-50/50 dark:border-violet-900 dark:bg-violet-950/30',
    }
  }
  if (tone === 'completed') {
    return {
      dotClass: 'bg-emerald-500',
      cardClass: 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
    }
  }
  return {
    dotClass: 'bg-slate-400',
    cardClass: 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
  }
}

/** Known PhyndCRM event types get Spanish labels; staff-written events show their message. */
export function clientEventText(entry: ClientTimelineEntry, copy: PortalCopy): string {
  return copy.eventLabel[entry.eventType] ?? entry.message ?? copy.genericUpdate
}

export function PortalActivity({
  timeline,
  copy,
}: {
  timeline: ClientTimelineEntry[]
  copy: PortalCopy
}) {
  return (
    <PortalSection title={copy.sections.activity}>
      {timeline.length === 0 ? (
        <PortalEmpty>{copy.activityEmpty}</PortalEmpty>
      ) : (
        <ol className="space-y-3">
          {timeline.map((entry) => {
            // Client view: a failed or blocked event reads as a plain update.
            const tone = timelineEventTone(entry.status, entry.eventType)
            const { dotClass, cardClass } = activityStyles(tone)
            return (
              <li className={`flex gap-3 rounded-md border p-3 ${cardClass}`} key={entry.id}>
                <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-900 dark:text-slate-100">
                    {clientEventText(entry, copy)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {formatPortalDateTime(entry.createdAt)}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </PortalSection>
  )
}

import { type PortalCopy, formatPortalDate, formatPortalMoney, labelFor } from '@/lib/portal/copy'
import type { ClientPaymentEvidence } from '@phynd/services'
import { PortalEmpty, PortalSection } from './portal-items'

// The client's payments: client-visible, non-voided receipts only
// (PaymentEvidenceService.listForClient). Shows date, amount, method, status
// and the receipt through the authorizing route, which redirects to a
// short-lived signed URL. Never more than the last four account digits.
// A plain <img>: next/image is not used in this app (optimizer off, AGENTS.md).

const STATUS_TONES: Record<string, string> = {
  verified: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100',
  recorded: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
}

/** Browsers render these inline; HEIC and PDF open as a link. */
const INLINE_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function PortalPayments({
  payments,
  copy,
  engagementId,
}: {
  payments: ClientPaymentEvidence[]
  copy: PortalCopy
  engagementId: string
}) {
  return (
    <PortalSection title={copy.sections.payments}>
      {payments.length === 0 ? (
        <PortalEmpty>{copy.paymentsEmpty}</PortalEmpty>
      ) : (
        <ul className="space-y-3">
          {payments.map((p) => {
            const fileUrl = `/portal/${encodeURIComponent(engagementId)}/payments/${encodeURIComponent(p.id)}/file`
            const last4 =
              p.originAccountLast4 && /^\d{4}$/.test(p.originAccountLast4)
                ? p.originAccountLast4
                : null
            return (
              <li
                className="rounded-md border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                key={p.id}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {formatPortalMoney(p.amount, p.currency)} {p.currency}
                    </p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      {labelFor(copy.paymentMethod, p.method)} · {formatPortalDate(p.paidAt)}
                    </p>
                    {last4 && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {copy.fromAccount(last4)}
                      </p>
                    )}
                    <span
                      className={`mt-3 inline-flex rounded-full px-2 py-1 text-xs font-medium ${STATUS_TONES[p.status] ?? STATUS_TONES.recorded}`}
                    >
                      {labelFor(copy.paymentEvidenceStatus, p.status)}
                    </span>
                  </div>
                  {p.hasEvidence &&
                    (p.evidenceMime && INLINE_IMAGE.has(p.evidenceMime) ? (
                      <a href={fileUrl} rel="noopener noreferrer" target="_blank">
                        <img
                          alt={copy.receiptAlt}
                          className="h-32 w-auto rounded border border-slate-200 object-contain dark:border-slate-800"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          src={fileUrl}
                        />
                      </a>
                    ) : (
                      <a
                        className="shrink-0 rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
                        href={fileUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {copy.viewReceipt}
                      </a>
                    ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </PortalSection>
  )
}

'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  formatMoney,
  formatMxDateTime,
} from '@/lib/payments/payment-form'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useState } from 'react'
import { PaymentDetail } from './payment-detail'
import { RecordPaymentForm } from './record-payment-form'

// «Pagos»: payment receipts of the engagement. Staff record a payment from a
// receipt (prefilled when the PDF is a BBVA comprobante), verify it, or void
// it (never deleted). The client portal shows client-visible, non-voided ones.

type Payment = inferRouterOutputs<AppRouter>['paymentEvidence']['list'][number]

export function EngagementPaymentsPanel({
  engagementId,
  contactId,
}: {
  engagementId: string
  contactId: string
}) {
  const peRouter = trpc.paymentEvidence as NonNullable<typeof trpc.paymentEvidence>
  const list = peRouter.list.useQuery({ engagementId })
  const quotes = trpc.quotes.listByContactId.useQuery({ contactId, limit: 100 })
  const orders = trpc.orders.listByContactId.useQuery({ contactId, limit: 100 })
  const [recording, setRecording] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const payments = (list.data ?? []) as Payment[]

  const quoteOptions = (quotes.data?.items ?? []).map((q) => ({
    id: q.id,
    label: `${q.quoteNumber} · ${formatMoney(q.totalAmount, q.currency)}`,
  }))
  const orderOptions = (orders.data?.items ?? []).map((o) => ({
    id: o.id,
    label: `${o.orderNumber} · ${formatMoney(o.totalAmount, o.currency)}`,
  }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Comprobantes privados; el cliente ve fecha, importe, método y estado.
        </p>
        {!recording && (
          <Button size="sm" onClick={() => setRecording(true)}>
            Registrar pago
          </Button>
        )}
      </div>
      {recording && (
        <RecordPaymentForm
          engagementId={engagementId}
          orders={orderOptions}
          quotes={quoteOptions}
          onDone={() => setRecording(false)}
        />
      )}
      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando pagos…</p>
      ) : payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no hay pagos registrados.</p>
      ) : (
        <ul className="space-y-2" aria-label="Pagos">
          {payments.map((p) => (
            <li className="space-y-2" key={p.id}>
              <button
                className="flex w-full flex-wrap items-center gap-3 rounded-md border p-3 text-left hover:bg-muted/40"
                type="button"
                onClick={() => setOpenId(openId === p.id ? null : p.id)}
              >
                <span className="font-medium">{formatMoney(p.amount, p.currency)}</span>
                <span className="text-sm text-muted-foreground">{formatMxDateTime(p.paidAt)}</span>
                <span className="text-sm">{PAYMENT_METHOD_LABELS[p.method] ?? p.method}</span>
                <Badge
                  variant={
                    p.status === 'verified'
                      ? 'success'
                      : p.status === 'voided'
                        ? 'destructive'
                        : 'secondary'
                  }
                >
                  {PAYMENT_STATUS_LABELS[p.status] ?? p.status}
                </Badge>
                {!p.clientVisible && <Badge variant="outline">interno</Badge>}
              </button>
              {openId === p.id && <PaymentDetail engagementId={engagementId} id={p.id} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

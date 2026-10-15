'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  formatCents,
  formatMoney,
  formatMxDateTime,
} from '@/lib/payments/payment-form'
import { trpc } from '@/lib/trpc/client'
import { toast } from 'sonner'

// Detail of one payment: evidence preview (short-lived signed URL), fields,
// reconciliation against its order or quote, history and the actions
// Verificar / Anular. Account numbers are only ever last-4.

const INLINE_IMAGE = /^image\/(jpeg|png|webp)$/

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2 break-words">{value ?? '—'}</dd>
    </div>
  )
}

function EvidencePreview({ id, mime }: { id: string; mime: string | null }) {
  const peRouter = trpc.paymentEvidence as NonNullable<typeof trpc.paymentEvidence>
  const url = peRouter.evidenceUrl.useQuery({ id })
  if (url.isLoading) return <p className="text-sm text-muted-foreground">Cargando comprobante…</p>
  if (url.error) return <p className="text-sm text-muted-foreground">{url.error.message}</p>
  const href = url.data?.url
  if (!href) return null
  return mime && INLINE_IMAGE.test(mime) ? (
    <a href={href} rel="noopener noreferrer" target="_blank">
      <img alt="Comprobante" className="max-h-96 w-full rounded border object-contain" src={href} />
    </a>
  ) : (
    <Button asChild size="sm" variant="outline">
      <a href={href} rel="noopener noreferrer" target="_blank">
        Abrir comprobante
      </a>
    </Button>
  )
}

type Detail = NonNullable<
  ReturnType<NonNullable<typeof trpc.paymentEvidence>['get']['useQuery']>['data']
>

function ReconciliationCard({
  r,
  balanceText,
}: {
  r: Detail['reconciliation']
  balanceText: string
}) {
  const target = r.target === 'order' ? 'Pedido' : r.target === 'quote' ? 'Cotización' : '—'
  return (
    <div className="rounded-md border bg-card p-3">
      <p className="text-sm font-medium">Conciliación</p>
      <dl className="mt-2 space-y-1">
        <Row label="Contra" value={target} />
        <Row label="Por cobrar" value={formatCents(r.dueCents, r.currency)} />
        <Row label="Recibido" value={formatCents(r.receivedCents, r.currency)} />
        <Row label="Verificado" value={formatCents(r.verifiedCents, r.currency)} />
      </dl>
      <p className="mt-2 text-sm font-medium">{balanceText}</p>
      {r.otherCurrencyCount > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {r.otherCurrencyCount} pago(s) en otra moneda no se suman.
        </p>
      )}
    </div>
  )
}

function History({ e }: { e: Detail['evidence'] }) {
  return (
    <div className="rounded-md border bg-card p-3 text-sm">
      <p className="font-medium">Historial</p>
      <ul className="mt-2 space-y-1 text-muted-foreground">
        <li>
          Registrado {formatMxDateTime(e.createdAt)} por {e.createdBy}
        </li>
        {e.verifiedAt && (
          <li>
            Verificado {formatMxDateTime(e.verifiedAt)} por {e.verifiedByUserId}
          </li>
        )}
        {e.voidedAt && (
          <li>
            Anulado {formatMxDateTime(e.voidedAt)} por {e.voidedByUserId}: {e.voidReason}
          </li>
        )}
      </ul>
    </div>
  )
}

const STATUS_VARIANT = {
  verified: 'success',
  voided: 'destructive',
  recorded: 'secondary',
} as const

export function PaymentDetail({ id, engagementId }: { id: string; engagementId: string }) {
  const utils = trpc.useUtils()
  const peRouter = trpc.paymentEvidence as NonNullable<typeof trpc.paymentEvidence>
  const peUtils = utils.paymentEvidence as NonNullable<typeof utils.paymentEvidence>
  const detail = peRouter.get.useQuery({ id })
  const refresh = async () => {
    await Promise.all([
      peUtils.get.invalidate({ id }),
      peUtils.list.invalidate({ engagementId }),
      utils.engagements.getTimeline.invalidate({ engagementId }),
    ])
  }
  const onError = (err: { message: string }) => {
    toast.error('No se pudo actualizar el pago', { description: err.message })
  }
  const verify = peRouter.verify.useMutation({
    onSuccess: async (r) => {
      toast.success(
        r.order?.applied ? `Verificado; pedido: ${r.order.paymentStatus}` : 'Pago verificado',
      )
      await refresh()
    },
    onError,
  })
  const voidMutation = peRouter.void.useMutation({
    onSuccess: async () => {
      toast.success('Pago anulado')
      await refresh()
    },
    onError,
  })

  if (detail.isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>
  if (!detail.data) return null
  const { evidence: e, reconciliation: r, balanceText } = detail.data

  return (
    <div className="grid gap-6 rounded-md border bg-muted/20 p-4 lg:grid-cols-2">
      <div className="space-y-3">
        {e.evidenceStorageKey ? (
          <EvidencePreview id={e.id} mime={e.evidenceMime} />
        ) : (
          <p className="text-sm text-muted-foreground">Sin archivo de comprobante.</p>
        )}
        <ReconciliationCard balanceText={balanceText} r={r} />
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_VARIANT[e.status] ?? 'secondary'}>
            {PAYMENT_STATUS_LABELS[e.status] ?? e.status}
          </Badge>
          <Badge variant={e.clientVisible ? 'outline' : 'secondary'}>
            {e.clientVisible ? 'visible para el cliente' : 'interno'}
          </Badge>
          <Badge variant="outline">{e.source === 'extracted' ? 'extraído' : 'manual'}</Badge>
        </div>
        <dl className="space-y-1">
          <Row label="Importe" value={formatMoney(e.amount, e.currency)} />
          <Row label="Fecha" value={formatMxDateTime(e.paidAt)} />
          <Row label="Método" value={PAYMENT_METHOD_LABELS[e.method] ?? e.method} />
          <Row label="Tipo de operación" value={e.operationType} />
          <Row label="Banco" value={e.bankName} />
          <Row label="Folio" value={e.folio} />
          <Row label="Clave de rastreo" value={e.trackingKey} />
          <Row label="Concepto" value={e.reference} />
          <Row
            label="Cuenta de origen"
            value={e.originAccountLast4 ? `•${e.originAccountLast4}` : null}
          />
          <Row
            label="Cuenta de destino"
            value={e.destinationAccountLast4 ? `•${e.destinationAccountLast4}` : null}
          />
          <Row label="Beneficiario" value={e.beneficiaryName} />
          <Row label="Notas" value={e.notes} />
        </dl>
        <History e={e} />
        <div className="flex flex-wrap gap-2">
          {e.status === 'recorded' && (
            <Button
              disabled={verify.isPending}
              size="sm"
              onClick={() => verify.mutate({ id: e.id })}
            >
              Verificar
            </Button>
          )}
          {e.status !== 'voided' && (
            <Button
              disabled={voidMutation.isPending}
              size="sm"
              variant="outline"
              onClick={() => {
                const reason = window.prompt('Motivo de la anulación (sin números de cuenta)')
                if (reason?.trim()) voidMutation.mutate({ id: e.id, reason: reason.trim() })
              }}
            >
              Anular
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

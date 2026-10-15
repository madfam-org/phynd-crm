// Pure helpers for the staff payment form («Pagos» tab). Dates are entered and
// shown in Mexico City time (UTC-6 all year since 2022).

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  spei_transfer: 'Transferencia SPEI',
  card: 'Tarjeta',
  cash: 'Efectivo',
  other: 'Otro',
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  recorded: 'Registrado',
  verified: 'Verificado',
  voided: 'Anulado',
}

export interface UploadResult {
  storageKey: string
  sha256: string
  mime: string
  size: number
  extraction: {
    extractor: string
    confidence: number
    fields: Record<string, string | undefined>
  } | null
}

export interface PaymentFormState {
  method: string
  amount: string
  currency: string
  paidAtLocal: string
  bankName: string
  operationType: string
  folio: string
  trackingKey: string
  reference: string
  originAccountLast4: string
  destinationAccountLast4: string
  beneficiaryName: string
  notes: string
  quoteId: string
  orderId: string
  clientVisible: boolean
}

export const EMPTY_PAYMENT_FORM: PaymentFormState = {
  method: 'spei_transfer',
  amount: '',
  currency: 'MXN',
  paidAtLocal: '',
  bankName: '',
  operationType: '',
  folio: '',
  trackingKey: '',
  reference: '',
  originAccountLast4: '',
  destinationAccountLast4: '',
  beneficiaryName: '',
  notes: '',
  quoteId: '',
  orderId: '',
  clientVisible: true,
}

const MX_OFFSET_MS = -6 * 60 * 60 * 1000

/** Date -> "YYYY-MM-DDTHH:mm" in Mexico City time, for <input type="datetime-local">. */
export function toMxLocal(date: Date | string): string {
  const shifted = new Date(new Date(date).getTime() + MX_OFFSET_MS)
  return shifted.toISOString().slice(0, 16)
}

/** "YYYY-MM-DDTHH:mm" in Mexico City time -> Date (null when empty or invalid). */
export function fromMxLocal(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null
  const date = new Date(`${value.length === 16 ? `${value}:00` : value}-06:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Extractor output -> form fields. Only last-4 account digits ever arrive here. */
export function prefillFromUpload(upload: UploadResult): PaymentFormState {
  const f = upload.extraction?.fields ?? {}
  const text = (v: string | undefined) => v ?? ''
  return {
    ...EMPTY_PAYMENT_FORM,
    method: f.method ?? EMPTY_PAYMENT_FORM.method,
    amount: text(f.amount),
    currency: f.currency ?? 'MXN',
    paidAtLocal: f.paidAt ? toMxLocal(f.paidAt) : '',
    bankName: text(f.bankName),
    operationType: text(f.operationType),
    folio: text(f.folio),
    trackingKey: text(f.trackingKey),
    reference: text(f.reference),
    originAccountLast4: /^\d{4}$/.test(f.originAccountLast4 ?? '')
      ? text(f.originAccountLast4)
      : '',
    destinationAccountLast4: /^\d{4}$/.test(f.destinationAccountLast4 ?? '')
      ? text(f.destinationAccountLast4)
      : '',
    beneficiaryName: text(f.beneficiaryName),
  }
}

const orNull = (v: string) => (v.trim() ? v.trim() : null)

/** Form + optional upload -> paymentEvidence.create input (minus engagementId). */
export function toCreateInput(form: PaymentFormState, upload: UploadResult | null) {
  const paidAt = fromMxLocal(form.paidAtLocal)
  if (!paidAt) throw new Error('Fecha y hora del pago requeridas')
  return {
    method: form.method as 'spei_transfer' | 'card' | 'cash' | 'other',
    amount: form.amount.trim().replace(/,/g, ''),
    currency: form.currency.trim().toUpperCase() || 'MXN',
    paidAt,
    bankName: orNull(form.bankName),
    operationType: orNull(form.operationType),
    folio: orNull(form.folio),
    trackingKey: orNull(form.trackingKey),
    reference: orNull(form.reference),
    originAccountLast4: orNull(form.originAccountLast4),
    destinationAccountLast4: orNull(form.destinationAccountLast4),
    beneficiaryName: orNull(form.beneficiaryName),
    notes: orNull(form.notes),
    quoteId: orNull(form.quoteId),
    orderId: orNull(form.orderId),
    clientVisible: form.clientVisible,
    source: upload?.extraction ? ('extracted' as const) : ('manual' as const),
    extractionConfidence: upload?.extraction?.confidence ?? null,
    evidenceStorageKey: upload?.storageKey ?? null,
    evidenceMime: upload?.mime ?? null,
    evidenceSha256: upload?.sha256 ?? null,
  }
}

export function formatMoney(amount: string | number | null | undefined, currency: string) {
  if (amount === null || amount === undefined || amount === '') return '—'
  return `${new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(Number(amount))} ${currency}`
}

export function formatCents(cents: number | null | undefined, currency: string) {
  return cents === null || cents === undefined ? '—' : formatMoney(cents / 100, currency)
}

export function formatMxDateTime(date: Date | string | null | undefined) {
  if (!date) return '—'
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(new Date(date))
}

'use client'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  EMPTY_PAYMENT_FORM,
  PAYMENT_METHOD_LABELS,
  type PaymentFormState,
  type UploadResult,
  prefillFromUpload,
  toCreateInput,
} from '@/lib/payments/payment-form'
import { trpc } from '@/lib/trpc/client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

// Staff flow: upload the receipt (kept private in R2), review the prefilled
// fields side by side with the file, confirm. Images and unknown PDFs are not
// read: the fields stay empty for manual entry. Nothing is saved before
// "Registrar pago".

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf'
const NONE = '__none__'

interface Option {
  id: string
  label: string
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  inputMode?: 'numeric' | 'decimal'
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function LinkSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Option[]
  onChange: (v: string) => void
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Sin ligar</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function EvidencePreview({ file, upload }: { file: File | null; upload: UploadResult | null }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return setObjectUrl(null)
    const url = URL.createObjectURL(file)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  if (!file) {
    return <p className="text-sm text-muted-foreground">Sin archivo: registro manual.</p>
  }
  return (
    <div className="space-y-2">
      {objectUrl ? (
        <img
          alt="Comprobante"
          className="max-h-96 w-full rounded border object-contain"
          src={objectUrl}
        />
      ) : (
        <p className="text-sm">{file.name}</p>
      )}
      {upload?.extraction ? (
        <p className="text-xs text-muted-foreground">
          Prellenado por {upload.extraction.extractor} (
          {Math.round(upload.extraction.confidence * 100)}% de los campos). Revisa antes de guardar.
        </p>
      ) : upload ? (
        <p className="text-xs text-muted-foreground">
          No se leyeron datos del archivo: captura los campos a mano.
        </p>
      ) : null}
    </div>
  )
}

export function RecordPaymentForm({
  engagementId,
  quotes,
  orders,
  onDone,
}: {
  engagementId: string
  quotes: Option[]
  orders: Option[]
  onDone: () => void
}) {
  const utils = trpc.useUtils()
  const peRouter = trpc.paymentEvidence as NonNullable<typeof trpc.paymentEvidence>
  const peUtils = utils.paymentEvidence as NonNullable<typeof utils.paymentEvidence>
  const create = peRouter.create.useMutation({
    onSuccess: async () => {
      toast.success('Pago registrado')
      await peUtils.list.invalidate({ engagementId })
      onDone()
    },
    onError: (err) => {
      toast.error('No se pudo registrar el pago', { description: err.message })
    },
  })
  const [file, setFile] = useState<File | null>(null)
  const [upload, setUpload] = useState<UploadResult | null>(null)
  const [uploading, setUploading] = useState(false)
  const [form, setForm] = useState<PaymentFormState>(EMPTY_PAYMENT_FORM)
  const set = (patch: Partial<PaymentFormState>) => setForm((f) => ({ ...f, ...patch }))

  async function onFile(next: File | null) {
    setFile(next)
    setUpload(null)
    if (!next) return
    setUploading(true)
    try {
      const body = new FormData()
      body.set('engagementId', engagementId)
      body.set('file', next)
      const res = await fetch('/api/payment-evidence/upload', { method: 'POST', body })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setUpload(json as UploadResult)
      setForm(prefillFromUpload(json as UploadResult))
    } catch (err) {
      toast.error('No se pudo subir el comprobante', {
        description: err instanceof Error ? err.message : String(err),
      })
      setFile(null)
    } finally {
      setUploading(false)
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      create.mutate({ engagementId, ...toCreateInput(form, upload) })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <form className="grid gap-6 rounded-md border p-4 lg:grid-cols-2" onSubmit={submit}>
      <div className="space-y-3">
        <div className="grid gap-1">
          <Label htmlFor="payment-file">
            Comprobante (JPEG, PNG, WebP, HEIC o PDF; 10 MB máx.)
          </Label>
          <Input
            accept={ACCEPT}
            disabled={uploading}
            id="payment-file"
            type="file"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <EvidencePreview file={file} upload={upload} />
      </div>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1 sm:col-span-2">
            <Label>Método</Label>
            <Select value={form.method} onValueChange={(v) => set({ method: v })}>
              <SelectTrigger aria-label="Método">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([value, text]) => (
                  <SelectItem key={value} value={value}>
                    {text}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field
            id="pay-amount"
            inputMode="decimal"
            label="Importe *"
            value={form.amount}
            onChange={(v) => set({ amount: v })}
          />
          <Field
            id="pay-currency"
            label="Moneda"
            value={form.currency}
            onChange={(v) => set({ currency: v })}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="pay-date">Fecha y hora (Ciudad de México) *</Label>
          <Input
            id="pay-date"
            type="datetime-local"
            value={form.paidAtLocal}
            onChange={(e) => set({ paidAtLocal: e.target.value })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id="pay-op"
            label="Tipo de operación"
            value={form.operationType}
            onChange={(v) => set({ operationType: v })}
          />
          <Field
            id="pay-bank"
            label="Banco"
            value={form.bankName}
            onChange={(v) => set({ bankName: v })}
          />
          <Field
            id="pay-folio"
            label="Folio"
            value={form.folio}
            onChange={(v) => set({ folio: v })}
          />
          <Field
            id="pay-tracking"
            label="Clave de rastreo"
            value={form.trackingKey}
            onChange={(v) => set({ trackingKey: v })}
          />
          <Field
            id="pay-origin"
            inputMode="numeric"
            label="Cuenta de origen (últimos 4)"
            placeholder="1234"
            value={form.originAccountLast4}
            onChange={(v) => set({ originAccountLast4: v })}
          />
          <Field
            id="pay-dest"
            inputMode="numeric"
            label="Cuenta de destino (últimos 4)"
            placeholder="5678"
            value={form.destinationAccountLast4}
            onChange={(v) => set({ destinationAccountLast4: v })}
          />
        </div>
        <Field
          id="pay-beneficiary"
          label="Beneficiario"
          value={form.beneficiaryName}
          onChange={(v) => set({ beneficiaryName: v })}
        />
        <Field
          id="pay-reference"
          label="Concepto"
          value={form.reference}
          onChange={(v) => set({ reference: v })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <LinkSelect
            label="Cotización"
            options={quotes}
            value={form.quoteId}
            onChange={(v) => set({ quoteId: v })}
          />
          <LinkSelect
            label="Pedido"
            options={orders}
            value={form.orderId}
            onChange={(v) => set({ orderId: v })}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="pay-notes">Notas internas (sin números de cuenta)</Label>
          <Textarea
            id="pay-notes"
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm" htmlFor="pay-visible">
          <Checkbox
            checked={form.clientVisible}
            id="pay-visible"
            onCheckedChange={(v) => set({ clientVisible: v === true })}
          />
          Visible para el cliente en su portal
        </label>
        <div className="flex gap-2">
          <Button disabled={create.isPending || uploading} size="sm" type="submit">
            Registrar pago
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
        </div>
      </div>
    </form>
  )
}

import { Badge, type BadgeProps } from '@/components/ui/badge'
import type { CaseStatus, CaseType } from '@phynd/db/schema'
import { isCaseOverdue } from '@phynd/services/cases/case-deadlines'

type Variant = NonNullable<BadgeProps['variant']>

export const CASE_TYPE_LABELS: Readonly<Record<CaseType, string>> = {
  support: 'Soporte',
  refund: 'Reembolso',
  data_rights: 'Derechos ARCO',
  invoice_correction: 'Corrección de factura',
}

export const CASE_STATUS_LABELS: Readonly<Record<CaseStatus, string>> = {
  open: 'Abierto',
  in_progress: 'En curso',
  resolved: 'Resuelto',
}

const STATUS_VARIANTS: Readonly<Record<CaseStatus, Variant>> = {
  open: 'warning',
  in_progress: 'default',
  resolved: 'success',
}

export function caseTypeLabel(type: string): string {
  return CASE_TYPE_LABELS[type as CaseType] ?? type
}

export function caseStatusLabel(status: string): string {
  return CASE_STATUS_LABELS[status as CaseStatus] ?? status
}

/** Date and time in Mexico City (24-hour clock), as staff read it. */
export function formatCaseDate(value: Date | string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: 'h23',
  })
}

export function CaseStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANTS[status as CaseStatus] ?? 'outline'}>
      {caseStatusLabel(status)}
    </Badge>
  )
}

/** «Vencido» while the case is unresolved past its due date; nothing otherwise. */
export function CaseOverdueBadge({
  row,
  now,
}: {
  row: { status: string; dueAt: Date | string }
  now?: Date
}) {
  if (!isCaseOverdue(row, now)) return null
  return (
    <Badge variant="error" title="La fecha límite ya pasó y el caso no está resuelto.">
      Vencido
    </Badge>
  )
}

/** Value for a `datetime-local` input, in the browser's own time zone. */
export function toDateTimeLocal(value: Date | string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

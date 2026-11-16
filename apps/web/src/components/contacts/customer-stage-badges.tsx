import { Badge, type BadgeProps } from '@/components/ui/badge'

type Variant = NonNullable<BadgeProps['variant']>

const STAGE: Readonly<Record<string, { label: string; variant: Variant }>> = {
  lead: { label: 'Prospecto', variant: 'outline' },
  customer: { label: 'Cliente', variant: 'success' },
  former_customer: { label: 'Excliente', variant: 'secondary' },
}

const HEALTH: Readonly<Record<string, { label: string; variant: Variant; title: string }>> = {
  ok: { label: 'Pagos al corriente', variant: 'success', title: 'Su último pago se cobró.' },
  payment_failed: {
    label: 'Pago fallido',
    variant: 'error',
    title: 'Su último intento de cobro falló.',
  },
  cancelled: {
    label: 'Cancelado',
    variant: 'warning',
    title: 'Canceló o se le reembolsó por completo, sin otro pago activo.',
  },
}

/** Lifecycle stage: Prospecto, Cliente or Excliente. */
export function CustomerStageBadge({ stage }: { stage: string | null | undefined }) {
  const shown = STAGE[stage ?? 'lead'] ?? STAGE.lead
  if (!shown) return null
  return <Badge variant={shown.variant}>{shown.label}</Badge>
}

/** Payment health derived from billing events; nothing for a contact without payments. */
export function CustomerHealthBadge({ health }: { health: string | null | undefined }) {
  const shown = health ? HEALTH[health] : undefined
  if (!shown) return null
  return (
    <Badge variant={shown.variant} title={shown.title}>
      {shown.label}
    </Badge>
  )
}

/** CSV / plain-text labels. */
export function customerStageLabel(stage: string | null | undefined): string {
  return STAGE[stage ?? 'lead']?.label ?? ''
}

export function customerHealthLabel(health: string | null | undefined): string {
  return health ? (HEALTH[health]?.label ?? '') : ''
}

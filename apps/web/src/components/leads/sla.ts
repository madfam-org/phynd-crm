// The first-contact deadline as staff read it: the signature "deadline clock"
// of the lead surfaces (DESIGN.md). Pure, so the list, the cards and the lead
// page agree, and tests pin the wording.

export type SlaKind = 'overdue' | 'due_soon' | 'on_track' | 'done' | 'none'

export interface SlaState {
  kind: SlaKind
  /** Short Spanish label: «Vencida hace 2 d», «Vence en 3 h», «Contactado». */
  label: string
  /** Full sentence for screen readers and tooltips. */
  description: string
}

/** Less than this left on a pending deadline reads as due soon. */
export const DUE_SOON_MS = 4 * 60 * 60 * 1000

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** «12 min», «3 h», «2 d»: the largest whole unit, at least 1. */
export function shortDuration(ms: number): string {
  const abs = Math.abs(ms)
  if (abs < HOUR) return `${Math.max(1, Math.round(abs / MINUTE))} min`
  if (abs < DAY) return `${Math.round(abs / HOUR)} h`
  return `${Math.round(abs / DAY)} d`
}

const DATE_TIME = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Mexico_City',
})

export function formatStaffDateTime(value: Date | string): string {
  return DATE_TIME.format(typeof value === 'string' ? new Date(value) : value)
}

export function slaState(
  task: { dueAt: Date | string | null; status: string } | null | undefined,
  now: Date = new Date(),
): SlaState {
  if (!task) return { kind: 'none', label: '—', description: 'Sin tarea de primer contacto' }
  if (task.status === 'completed') {
    return { kind: 'done', label: 'Contactado', description: 'Primer contacto hecho' }
  }
  if (task.status !== 'pending' || !task.dueAt) {
    return { kind: 'none', label: '—', description: 'Primer contacto sin fecha' }
  }
  const due = typeof task.dueAt === 'string' ? new Date(task.dueAt) : task.dueAt
  const left = due.getTime() - now.getTime()
  const when = formatStaffDateTime(due)
  if (left < 0) {
    return {
      kind: 'overdue',
      label: `Vencida hace ${shortDuration(left)}`,
      description: `Primer contacto vencido desde ${when}`,
    }
  }
  return {
    kind: left <= DUE_SOON_MS ? 'due_soon' : 'on_track',
    label: `Vence en ${shortDuration(left)}`,
    description: `Primer contacto antes de ${when}`,
  }
}

/** «hace 3 h», «hace 2 d», «ahora». */
export function timeAgo(value: Date | string | null | undefined, now: Date = new Date()): string {
  if (!value) return '—'
  const at = typeof value === 'string' ? new Date(value) : value
  const ms = now.getTime() - at.getTime()
  if (ms < MINUTE) return 'ahora'
  return `hace ${shortDuration(ms)}`
}

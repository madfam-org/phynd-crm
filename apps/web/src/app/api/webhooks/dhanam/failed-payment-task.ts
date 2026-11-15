import type { getDb } from '@phynd/db'
import { activities, contacts } from '@phynd/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { classifyPaymentLifecycle } from './payment-lifecycle'

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

/**
 * Marks a task this path created. `activities` has no metadata column, so the
 * mark is a fixed line in the description; the look-up for an open task
 * searches for it. Staff who delete that line from a task detach it: the next
 * failed payment then opens a new one.
 */
export const FAILED_PAYMENT_TASK_MARKER = 'Ref.: dhanam-pago-fallido'

// Near due date: the task-reminders job notifies the owner of a pending task
// due within 24 h, so the owner hears about it on its next run.
const DUE_IN_MS = 24 * 60 * 60 * 1000
// `activities.title` is varchar(255).
const TITLE_MAX = 255
const REASON_MAX = 200
// Four or more digits, possibly split by spaces or dashes: a card number,
// its last four, an account or CLABE fragment. Never kept in the task text.
const DIGIT_RUN = /\d(?:[\s-]*\d){3,}/g

export interface FailedPaymentEvent {
  eventId: string
  eventType: string
  amountMinor: number | null
  currency: string | null
  raw: Record<string, unknown>
}

export type FailedPaymentTaskResult = { status: 'created' | 'already_open'; taskId: string }

export function isFailedPaymentEvent(eventType: string): boolean {
  return classifyPaymentLifecycle(eventType) === 'failed'
}

/**
 * On a failed-payment event, open one follow-up task on the contact so the
 * team finds out. Runs inside the event's transaction, after the per-event
 * lock, so a redelivered event never reaches it twice. Retries of the charge
 * arrive as new events: a per-contact lock and the look-up for an open task
 * carrying {@link FAILED_PAYMENT_TASK_MARKER} keep it to one open task.
 *
 * The task goes to the contact's owner; with no owner it stays unassigned
 * (`owner_id` null), as other system-created activities do.
 */
export async function maybeOpenFailedPaymentTask(
  tx: Tx,
  event: FailedPaymentEvent,
  contactId: string,
  now: Date = new Date(),
): Promise<FailedPaymentTaskResult | null> {
  if (!isFailedPaymentEvent(event.eventType)) return null

  // Taken after the per-event lock; no other path takes this key.
  const lockKey = `phynd:dhanam:failed-payment-task:${contactId}`
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`)

  const [open] = await tx
    .select({ id: activities.id })
    .from(activities)
    .where(
      and(
        eq(activities.entityType, 'contact'),
        eq(activities.entityId, contactId),
        eq(activities.type, 'task'),
        eq(activities.status, 'pending'),
        sql`strpos(${activities.description}, ${FAILED_PAYMENT_TASK_MARKER}) > 0`,
      ),
    )
    .limit(1)
  if (open?.id) return { status: 'already_open', taskId: open.id }

  const [contact] = await tx
    .select({ ownerId: contacts.ownerId })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1)

  const [task] = await tx
    .insert(activities)
    .values({
      type: 'task',
      title: failedPaymentTaskTitle(event),
      description: failedPaymentTaskDescription(event),
      status: 'pending',
      dueAt: new Date(now.getTime() + DUE_IN_MS),
      entityType: 'contact',
      entityId: contactId,
      ownerId: contact?.ownerId ?? null,
    })
    .returning({ id: activities.id })
  if (!task?.id) throw new Error('failed-payment task insert returned no row')
  return { status: 'created', taskId: task.id }
}

export function failedPaymentTaskTitle(event: FailedPaymentEvent): string {
  const amount = formatAmount(event)
  const title = amount
    ? `Pago fallido (${amount}): dar seguimiento`
    : 'Pago fallido: dar seguimiento'
  return title.slice(0, TITLE_MAX)
}

export function failedPaymentTaskDescription(event: FailedPaymentEvent): string {
  const amount = formatAmount(event)
  const reason = failureReason(event.raw)
  return [
    'El cobro de este cliente no se pudo completar.',
    amount ? `Monto: ${amount}.` : undefined,
    reason ? `Motivo: ${reason}.` : undefined,
    'Contacta al cliente para resolver el pago.',
    `Evento: ${event.eventId}`,
    FAILED_PAYMENT_TASK_MARKER,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')
}

function formatAmount(event: FailedPaymentEvent): string | null {
  if (event.amountMinor == null || !Number.isFinite(event.amountMinor)) return null
  const major = new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(event.amountMinor / 100)
  return event.currency ? `${major} ${event.currency}` : major
}

/**
 * The failure reason as the processor states it, with its code when given.
 * Read from the relay's flat `data.failure_reason` / `data.failure_code`, or
 * Stripe's `last_payment_error` / charge `failure_message`. Payment-method
 * fields are never read, and digit runs are removed from what is kept.
 */
export function failureReason(raw: Record<string, unknown>): string | null {
  const data = asRecord(raw.data)
  const object = asRecord(data.object)
  const lastError = asRecord(object.last_payment_error)
  // The description ends the sentence, so a trailing period is dropped here.
  const message = firstText(
    data.failure_reason,
    lastError.message,
    object.failure_message,
    data.failure_message,
  )?.replace(/\.+$/, '')
  const code = firstText(
    data.failure_code,
    lastError.decline_code,
    lastError.code,
    object.failure_code,
  )
  const parts = [message, code ? `código ${code}` : null].filter((p): p is string => Boolean(p))
  if (parts.length === 0) return null
  const text = (parts.length === 2 ? `${parts[0]} (${parts[1]})` : (parts[0] ?? ''))
    .replace(DIGIT_RUN, '[oculto]')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? text.slice(0, REASON_MAX) : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

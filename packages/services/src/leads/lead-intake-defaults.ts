import { activities, leads } from '@phynd/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'

// What every intake feed does to a new lead after it is stored (G2): give it
// an owner when it has none, and open its "First contact" task. The worker's
// one-off backfill applies the same rule to existing leads.

/** `activities.kind` of a lead's first-contact task. */
export const FIRST_CONTACT_TASK_KIND = 'first_contact'

/** Title prefix of the first-contact task; the lead's name follows. */
export const FIRST_CONTACT_TASK_TITLE = 'First contact'

/** `activities.title` is varchar(255). */
const TITLE_MAX = 255

/** Staff work in Mexico City: the follow-up clock runs there. */
const STAFF_TIME_ZONE = 'America/Mexico_City'
/** 09:00 in Mexico City, which is UTC-6 all year. */
const FOLLOW_UP_HOUR_UTC = 15

/**
 * 09:00 Mexico City on the next business day (Monday to Friday) after `now`.
 * Public holidays are not considered.
 */
export function nextBusinessDayDueAt(now: Date = new Date()): Date {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: STAFF_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .split('-')
    .map(Number) as [number, number, number]

  const cursor = new Date(Date.UTC(year, month - 1, day))
  do {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  } while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6)

  cursor.setUTCHours(FOLLOW_UP_HOUR_UTC, 0, 0, 0)
  return cursor
}

/** «First contact: <name>», cut to the column. */
export function firstContactTitle(name: string | null | undefined): string {
  const label = name?.trim()
    ? `${FIRST_CONTACT_TASK_TITLE}: ${name.trim()}`
    : FIRST_CONTACT_TASK_TITLE
  return Array.from(label).slice(0, TITLE_MAX).join('')
}

export interface LeadIntakeDefaultsInput {
  leadId: string
  /** The owner to give the lead when it has none (null: leave it unassigned). */
  ownerId: string | null
  /** Shown in the task title. */
  displayName?: string | null
  /** A feed's own title for the task (kept as the feed wrote it); default «First contact: <name>». */
  title?: string
  description?: string
  now?: Date
}

export interface LeadIntakeDefaultsResult {
  /** The lead's owner after the call. */
  ownerId: string | null
  /** The first-contact task opened by this call, or null when one already existed. */
  taskId: string | null
  dueAt: Date | null
}

/**
 * Sets the lead's owner when it has none and opens its "First contact" task,
 * due the next business day and owned by the lead's owner, unless the lead
 * already has one (any status). Idempotent: a second call changes nothing.
 * Runs on the caller's handle, so inside the caller's transaction when there is
 * one.
 */
export async function applyLeadIntakeDefaults(
  ctx: Pick<ServiceContext, 'db'>,
  input: LeadIntakeDefaultsInput,
): Promise<LeadIntakeDefaultsResult> {
  const db = ctx.db
  if (input.ownerId) {
    await db
      .update(leads)
      .set({ ownerId: input.ownerId })
      .where(and(eq(leads.id, input.leadId), isNull(leads.ownerId)))
  }
  const [lead] = await db
    .select({ ownerId: leads.ownerId })
    .from(leads)
    .where(eq(leads.id, input.leadId))
    .limit(1)
  const ownerId = lead?.ownerId ?? null

  const [existing] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(
      and(
        eq(activities.entityType, 'lead'),
        eq(activities.entityId, input.leadId),
        eq(activities.kind, FIRST_CONTACT_TASK_KIND),
      ),
    )
    .limit(1)
  if (existing) return { ownerId, taskId: null, dueAt: null }

  const dueAt = nextBusinessDayDueAt(input.now)
  const [task] = await db
    .insert(activities)
    .values({
      type: 'task',
      kind: FIRST_CONTACT_TASK_KIND,
      title: input.title
        ? Array.from(input.title).slice(0, TITLE_MAX).join('')
        : firstContactTitle(input.displayName),
      description: input.description ?? null,
      dueAt,
      entityType: 'lead',
      entityId: input.leadId,
      ownerId,
    })
    .returning({ id: activities.id })
  return { ownerId, taskId: task?.id ?? null, dueAt }
}

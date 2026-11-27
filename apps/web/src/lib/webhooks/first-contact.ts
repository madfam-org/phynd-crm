import { ActivitiesService, type ServiceContext, withTransaction } from '@phynd/services'
import { nextBusinessDayDueAt } from '@phynd/services/tasks/follow-up-due'
import { resolveSystemTaskOwner } from './system-task-owner'

// What every inbound-lead route does once the lead row exists: the lead gets
// an owner and one "Primer contacto" (first contact) task due the next
// business day. Used by the Avala, Nauta and lead-intake (Kalya, site forms,
// Cotiza) receivers so the rule is the same for each.
//
// Owner rule: the contact's owner, else `PHYND_CRM_DEFAULT_TASK_OWNER_ID` (the
// system task owner, see `system-task-owner.ts`), else none. The lead and its
// task get the same owner; with none, both stay unassigned and one
// `DEFAULT_TASK_OWNER_UNAVAILABLE` warning is logged per lead.

/** Title prefix of the task every inbound lead opens. */
export const FIRST_CONTACT_TITLE_PREFIX = 'Primer contacto'

/** `activities.title` is varchar(255). */
const TITLE_MAX = 255

interface WarnLogger {
  warn(fields: Record<string, unknown>, message: string): void
}

/** «Primer contacto: <subject>», cut to the column without splitting a character. */
export function firstContactTitle(subject: string): string {
  const title = `${FIRST_CONTACT_TITLE_PREFIX}: ${subject}`
  const chars = Array.from(title)
  return chars.length > TITLE_MAX ? chars.slice(0, TITLE_MAX).join('') : title
}

/**
 * The owner of a new inbound lead and of its first-contact task. `db` is the
 * caller's handle (its transaction when there is one). Identifiers only in the
 * log context.
 */
export function resolveIntakeLeadOwner(
  db: Parameters<typeof resolveSystemTaskOwner>[0],
  logger: WarnLogger,
  input: {
    contactOwnerId: string | null | undefined
    source: string
    contactId: string
    env?: Record<string, string | undefined>
  },
): Promise<string | null> {
  return resolveSystemTaskOwner(db, logger, {
    contactOwnerId: input.contactOwnerId,
    logContext: { task: 'lead_first_contact', source: input.source, contact_id: input.contactId },
    env: input.env,
  })
}

/**
 * Opens the first-contact task on the lead, due 09:00 Mexico City on the next
 * business day. Best effort: it runs in a savepoint (or its own transaction
 * when the caller has none), so a failure rolls back the task only, is
 * logged, and returns `null`; the lead is kept.
 */
export async function openFirstContactTask(
  ctx: ServiceContext,
  logger: WarnLogger,
  input: {
    leadId: string
    ownerId: string | null
    subject: string
    description: string
    now?: Date
  },
): Promise<Date | null> {
  const dueAt = nextBusinessDayDueAt(input.now)
  try {
    await ctx.db.transaction((savepoint) =>
      new ActivitiesService(withTransaction(ctx, savepoint)).create({
        type: 'task',
        title: firstContactTitle(input.subject),
        description: input.description,
        dueAt,
        entityType: 'lead',
        entityId: input.leadId,
        ownerId: input.ownerId,
      }),
    )
    return dueAt
  } catch (error) {
    logger.warn({ err: error, leadId: input.leadId }, 'first-contact task not created')
    return null
  }
}

import type { getDb } from '@phynd/db'
import { users } from '@phynd/db/schema'
import { eq } from 'drizzle-orm'

/**
 * CRM user id (`users.id`, not a Janua subject) that receives a task the system
 * opens on a contact with no owner (lead-intake follow-ups, failed-payment
 * tasks). The task-reminders job skips unassigned tasks, so without it nobody
 * is reminded of them.
 */
export const DEFAULT_TASK_OWNER_ENV = 'PHYND_CRM_DEFAULT_TASK_OWNER_ID'

/** Stable code of the warning logged when a system task stays unassigned. */
export const DEFAULT_TASK_OWNER_UNAVAILABLE = 'DEFAULT_TASK_OWNER_UNAVAILABLE'

/** CRM ids are short generated ids; a value this long is misconfigured and not looked up. */
const MAX_USER_ID_LENGTH = 255

/** The database or a transaction on it: both select the same way. */
type OwnerLookupDb = Pick<ReturnType<typeof getDb>, 'select'>

interface WarnLogger {
  warn(fields: Record<string, unknown>, message: string): void
}

export interface SystemTaskOwnerInput {
  /** The contact's own owner; kept whenever it is set. */
  contactOwnerId: string | null | undefined
  /** Identifiers for the warning line (never personal data). */
  logContext?: Record<string, unknown>
  /** Defaults to `process.env`; tests pass their own. */
  env?: Record<string, string | undefined>
}

/**
 * Owner for a task the system opens on a contact: the contact's owner, else
 * the configured default owner when it names an existing CRM user, else null
 * (unassigned, as before). Each task that ends up unassigned because the
 * default is unset, empty or names no user logs one warning with
 * {@link DEFAULT_TASK_OWNER_UNAVAILABLE}.
 *
 * `db` is the caller's handle (a transaction when the task is written in one),
 * so the look-up sees the same snapshot as the insert.
 */
export async function resolveSystemTaskOwner(
  db: OwnerLookupDb,
  logger: WarnLogger,
  input: SystemTaskOwnerInput,
): Promise<string | null> {
  if (input.contactOwnerId) return input.contactOwnerId

  const configured = (input.env ?? process.env)[DEFAULT_TASK_OWNER_ENV]?.trim() ?? ''
  if (!configured) {
    warnUnassigned(logger, 'unset', input.logContext)
    return null
  }
  if (configured.length > MAX_USER_ID_LENGTH || !(await userExists(db, configured))) {
    warnUnassigned(logger, 'unknown_user', input.logContext)
    return null
  }
  return configured
}

async function userExists(db: OwnerLookupDb, id: string): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1)
  return rows.length > 0
}

function warnUnassigned(
  logger: WarnLogger,
  reason: 'unset' | 'unknown_user',
  logContext: Record<string, unknown> | undefined,
): void {
  // The configured id is not logged: it is configuration, and the reason says
  // what to fix.
  logger.warn(
    { ...logContext, code: DEFAULT_TASK_OWNER_UNAVAILABLE, reason, env: DEFAULT_TASK_OWNER_ENV },
    `${DEFAULT_TASK_OWNER_UNAVAILABLE}: system task on a contact without owner left unassigned (${
      reason === 'unset' ? `${DEFAULT_TASK_OWNER_ENV} is not set` : `${DEFAULT_TASK_OWNER_ENV} names no CRM user`
    })`,
  )
}

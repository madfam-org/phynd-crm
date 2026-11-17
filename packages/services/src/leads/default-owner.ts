import type { getDb } from '@phynd/db'
import { users } from '@phynd/db/schema'
import { eq } from 'drizzle-orm'

/**
 * The CRM user that receives a task the system opens on a contact with no
 * owner (lead-intake follow-ups, failed-payment tasks), and the owner of a new
 * lead that no routing rule assigns (the contact's own owner is the rule). The task-reminders job
 * skips unassigned tasks, so without it nobody is reminded of them. Two forms:
 *   - a CRM user id (`users.id`);
 *   - `janua:<subject>`: the CRM user linked to that Janua subject
 *     (`users.external_janua_id`), for operators who know their identity but
 *     not the CRM's generated id.
 */
export const DEFAULT_TASK_OWNER_ENV = 'PHYND_CRM_DEFAULT_TASK_OWNER_ID'

/** Prefix of the Janua-subject form of {@link DEFAULT_TASK_OWNER_ENV}. */
export const JANUA_SUBJECT_PREFIX = 'janua:'

/** Stable code of the warning logged when a system task stays unassigned. */
export const DEFAULT_TASK_OWNER_UNAVAILABLE = 'DEFAULT_TASK_OWNER_UNAVAILABLE'

/**
 * CRM ids are short generated ids and Janua subjects fit `external_janua_id`
 * (varchar 255); a longer value is misconfigured and not looked up.
 */
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
 * the configured default owner when it names an existing CRM user (by id, or
 * by linked Janua subject in the `janua:<subject>` form), else null
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
  const owner = await findConfiguredUser(db, configured)
  if (!owner) {
    warnUnassigned(logger, 'unknown_user', input.logContext)
    return null
  }
  return owner
}

/**
 * The configured default owner as a CRM user id, or null when it is unset,
 * malformed or names no CRM user. Logs nothing: callers that leave something
 * unassigned because of it log their own line.
 */
export async function findDefaultOwner(
  db: OwnerLookupDb,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const configured = env[DEFAULT_TASK_OWNER_ENV]?.trim() ?? ''
  if (!configured) return null
  return findConfiguredUser(db, configured)
}

/** The CRM user id the configured value names, or null (never looked up when malformed). */
async function findConfiguredUser(db: OwnerLookupDb, configured: string): Promise<string | null> {
  const subject = configured.startsWith(JANUA_SUBJECT_PREFIX)
    ? configured.slice(JANUA_SUBJECT_PREFIX.length).trim()
    : null
  const key = subject ?? configured
  if (!key || key.length > MAX_USER_ID_LENGTH) return null
  const column = subject === null ? users.id : users.externalJanuaId
  const [row] = await db.select({ id: users.id }).from(users).where(eq(column, key)).limit(1)
  return row?.id ?? null
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
      reason === 'unset'
        ? `${DEFAULT_TASK_OWNER_ENV} is not set`
        : `${DEFAULT_TASK_OWNER_ENV} names no CRM user (an id, or janua:<subject> of a linked user)`
    })`,
  )
}

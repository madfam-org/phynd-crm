import { createLogger } from '@phynd/logging'
import { type StaffRole, isStaffRole } from '@phynd/types/auth'

const logger = createLogger('web:auth:staff-bootstrap')

/** One bootstrap entry: a role for a Janua subject. */
export interface StaffBootstrapEntry {
  role: StaffRole
  subject: string
}

/**
 * Staff bootstrap list. `PHYND_BOOTSTRAP_STAFF` is a comma-separated list of
 * `<role>:sub:<janua-subject>` entries, role one of `STAFF_ROLES`. Only
 * subjects are accepted: an email address is not a safe key, because the
 * identity service marks emails verified for SSO, SCIM and social sign-ups that
 * an organization administrator controls. The legacy
 * `PHYND_BOOTSTRAP_ADMIN_SUBS` (comma-separated subjects) still means
 * `admin:sub:<subject>` and is read after it. A malformed entry, an email entry
 * included, is skipped with a warning that names its position, never its value.
 */
export function staffBootstrapEntries(
  env: Record<string, string | undefined> = process.env,
): StaffBootstrapEntry[] {
  const entries: StaffBootstrapEntry[] = []
  const raw = (env.PHYND_BOOTSTRAP_STAFF ?? '').split(',')
  raw.forEach((item, index) => {
    const value = item.trim()
    if (!value) return
    const entry = parseEntry(value)
    if (entry) entries.push(entry)
    else logger.warn({ position: index + 1 }, 'PHYND_BOOTSTRAP_STAFF: malformed entry skipped')
  })
  for (const subject of (env.PHYND_BOOTSTRAP_ADMIN_SUBS ?? '').split(',')) {
    if (subject.trim()) entries.push({ role: 'admin', subject: subject.trim() })
  }
  return entries
}

function parseEntry(value: string): StaffBootstrapEntry | null {
  const match = /^([a-z_]+):sub:(\S+)$/.exec(value)
  if (!match) return null
  const [, role, subject] = match
  if (!isStaffRole(role) || !subject) return null
  return { role, subject }
}

/**
 * The role listed for a Janua subject that has no CRM user yet, or null. The
 * subject must match exactly; the first matching entry wins.
 */
export function matchStaffBootstrap(
  entries: StaffBootstrapEntry[],
  subject: string,
): StaffRole | null {
  if (!subject) return null
  return entries.find((entry) => entry.subject === subject)?.role ?? null
}

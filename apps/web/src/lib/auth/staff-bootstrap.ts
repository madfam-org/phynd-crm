import { createLogger } from '@phynd/logging'
import { type StaffRole, isStaffRole } from '@phynd/types/auth'

const logger = createLogger('web:auth:staff-bootstrap')

/** One bootstrap entry: a role for a Janua subject or for a verified email address. */
export type StaffBootstrapEntry =
  | { role: StaffRole; subject: string; email?: undefined }
  | { role: StaffRole; email: string; subject?: undefined }

export interface StaffBootstrapMatch {
  role: StaffRole
  by: 'subject' | 'email'
}

/**
 * Staff bootstrap list. `PHYND_BOOTSTRAP_STAFF` is a comma-separated list of
 * `<role>:<email>` or `<role>:sub:<janua-subject>` entries, role one of
 * `STAFF_ROLES` (e.g. `admin:owner@example.com,manager:sub:<uuid>`). The
 * legacy `PHYND_BOOTSTRAP_ADMIN_SUBS` (comma-separated subjects) still means
 * `admin:sub:<subject>` and is read after it. A malformed entry is skipped
 * with a warning that names its position, never its value.
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
  const sep = value.indexOf(':')
  if (sep <= 0) return null
  const role = value.slice(0, sep).trim()
  const target = value.slice(sep + 1).trim()
  if (!isStaffRole(role)) return null
  if (target.startsWith('sub:')) {
    const subject = target.slice(4).trim()
    return subject ? { role, subject } : null
  }
  // One address, no spaces, something on both sides of a single "@".
  if (!/^[^\s@]+@[^\s@]+$/.test(target)) return null
  return { role, email: target.toLowerCase() }
}

/**
 * The bootstrap entry for a signed-in account that has no CRM user yet, or
 * null. The first matching entry wins. A subject entry matches the Janua
 * subject exactly. An email entry matches the account's email exactly
 * (case-insensitive) and only when Janua marks it verified; a match on an
 * unverified email is refused and logged with the subject and role.
 */
export function matchStaffBootstrap(
  entries: StaffBootstrapEntry[],
  account: { subject: string; email?: string | null; emailVerified: boolean },
): StaffBootstrapMatch | null {
  const email = account.email?.trim().toLowerCase() ?? ''
  for (const entry of entries) {
    if (entry.subject !== undefined) {
      if (account.subject && entry.subject === account.subject) {
        return { role: entry.role, by: 'subject' }
      }
      continue
    }
    if (!email || entry.email !== email) continue
    if (!account.emailVerified) {
      logger.warn(
        { januaSub: account.subject, role: entry.role },
        'bootstrap: email entry matched an account whose email Janua does not mark verified; refused',
      )
      return null
    }
    return { role: entry.role, by: 'email' }
  }
  return null
}

import { isFeatureEnabled } from '@phynd/config/features'
import type { AuthContext } from '@phynd/types/auth'

/**
 * Masking applies to service principals. For a staff session `auth.roles` is
 * its linked CRM user's role (never a role from the identity service's tokens),
 * so the admin bypass follows the CRM role and a staff session never carries
 * `service`.
 */
export function shouldMaskPiiForAgent(auth: AuthContext): boolean {
  if (!isFeatureEnabled('piiMasking')) return false
  if (auth.roles.includes('admin')) return false
  return auth.roles.includes('service') || auth.userId.startsWith('service:')
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  return `${email.slice(0, 1)}***${email.slice(at)}`
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '***'
  return `***${digits.slice(-4)}`
}

export function maskPersonName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return 'Contact'
  return `${parts[0]} ***`
}

/** What a value masked as a whole reads; nothing of the original is kept. */
export const MASKED_VALUE = '[redacted]'

/**
 * Mask a value as a whole (a company name, a lead source): the result is the
 * fixed {@link MASKED_VALUE}, so it is recognisably masked and keeps nothing
 * of the original (not its first letters, not its length) to reverse. Absent
 * stays null, so a reader can still tell "none" from "masked".
 */
export function maskWholeValue(value: string | null | undefined): string | null {
  if (!value) return null
  return MASKED_VALUE
}

export function maskFreeText(text: string | null | undefined): string | null {
  if (!text) return null
  if (text.length <= 24) return '[redacted]'
  return `${text.slice(0, 12)}…[redacted]`
}

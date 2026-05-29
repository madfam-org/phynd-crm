import { isFeatureEnabled } from '@phynd/config/features'
import type { AuthContext } from '@phynd/types/auth'

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

export function maskFreeText(text: string | null | undefined): string | null {
  if (!text) return null
  if (text.length <= 24) return '[redacted]'
  return `${text.slice(0, 12)}…[redacted]`
}

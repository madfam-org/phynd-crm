import { createHash, randomBytes } from 'node:crypto'

export const DOUBLE_OPT_IN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Generates a double-opt-in confirmation token. Only the SHA-256 hash is
 * persisted; the raw token travels in the confirmation URL.
 */
export function generateDoubleOptInToken(): { token: string; tokenHash: string } {
  const token = randomBytes(24).toString('base64url')
  return { token, tokenHash: hashDoubleOptInToken(token) }
}

export function hashDoubleOptInToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function buildConsentConfirmUrl(token: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://phynd.app'
  return `${baseUrl}/api/consent/confirm?token=${encodeURIComponent(token)}`
}

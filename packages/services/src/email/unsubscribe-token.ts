import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Resolve the HMAC secret lazily so importing this module never throws, while
 * still failing closed in production when no real secret is configured. The
 * previous hardcoded `'dev-unsub-secret'` fallback would silently sign prod
 * tokens with a public string.
 */
function resolveSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.AUTH_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('UNSUBSCRIBE_SECRET (or AUTH_SECRET) must be set in production')
  }
  return 'dev-unsub-secret'
}

export function generateUnsubscribeToken(leadId: string): string {
  const hmac = createHmac('sha256', resolveSecret())
  hmac.update(leadId)
  return `${leadId}.${hmac.digest('hex').slice(0, 16)}`
}

export function verifyUnsubscribeToken(token: string): string | null {
  const [leadId, sig] = token.split('.')
  if (!leadId || !sig) return null
  const expected = generateUnsubscribeToken(leadId).split('.')[1] ?? ''
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length) return null
  return timingSafeEqual(sigBuf, expectedBuf) ? leadId : null
}

export function buildUnsubscribeUrl(leadId: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://phynd.app'
  return `${baseUrl}/api/unsubscribe?token=${generateUnsubscribeToken(leadId)}`
}

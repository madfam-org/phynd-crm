import { createHmac } from 'crypto'

const SECRET = process.env.UNSUBSCRIBE_SECRET || process.env.AUTH_SECRET || 'dev-unsub-secret'

export function generateUnsubscribeToken(leadId: string): string {
  const hmac = createHmac('sha256', SECRET)
  hmac.update(leadId)
  return `${leadId}.${hmac.digest('hex').slice(0, 16)}`
}

export function verifyUnsubscribeToken(token: string): string | null {
  const [leadId, sig] = token.split('.')
  if (!leadId || !sig) return null
  const expected = generateUnsubscribeToken(leadId).split('.')[1]
  return sig === expected ? leadId : null
}

export function buildUnsubscribeUrl(leadId: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.madfam.io'
  return `${baseUrl}/api/unsubscribe?token=${generateUnsubscribeToken(leadId)}`
}

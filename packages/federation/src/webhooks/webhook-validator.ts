import crypto from 'node:crypto'

export function validateWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  const normalizedSig = signature.startsWith('sha256=') ? signature.slice(7) : signature

  return crypto.timingSafeEqual(Buffer.from(normalizedSig), Buffer.from(expected))
}

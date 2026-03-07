import crypto from 'node:crypto'

const TIME_BUCKET_MS = 5 * 60 * 1000 // 5 minutes

export function generateIdempotencyKey(
  provider: string,
  method: string,
  externalId: string,
): string {
  const timeBucket = Math.floor(Date.now() / TIME_BUCKET_MS)
  const payload = `${provider}:${method}:${externalId}:${timeBucket}`
  return crypto.createHash('sha256').update(payload).digest('hex')
}

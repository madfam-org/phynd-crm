import { createHmac, timingSafeEqual } from 'node:crypto'

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000 // 5 minutes

export type SvixVerification =
  | { ok: true; messageId: string }
  | { ok: false; reason: 'missing_headers' | 'timestamp_out_of_tolerance' | 'invalid_signature' }

/**
 * Verifies a Svix-signed webhook (the scheme Resend uses). No svix
 * dependency — the scheme is HMAC-SHA256 over `${id}.${timestamp}.${body}`
 * keyed with the base64 payload of the `whsec_…` secret, compared (timing
 * safe) against the space-separated `v1,<base64>` entries in the
 * `svix-signature` header.
 */
export function verifySvixSignature(
  body: string,
  headers: { svixId: string | null; svixTimestamp: string | null; svixSignature: string | null },
  secret: string,
  now: Date = new Date(),
): SvixVerification {
  const { svixId, svixTimestamp, svixSignature } = headers
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, reason: 'missing_headers' }
  }

  const timestampMs = Number.parseInt(svixTimestamp, 10) * 1000
  if (Number.isNaN(timestampMs) || Math.abs(now.getTime() - timestampMs) > MAX_TIMESTAMP_SKEW_MS) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' }
  }

  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64')
  const expected = createHmac('sha256', key).update(`${svixId}.${svixTimestamp}.${body}`).digest()

  for (const part of svixSignature.split(' ')) {
    const [version, signature] = part.split(',')
    if (version !== 'v1' || !signature) continue
    const candidate = Buffer.from(signature, 'base64')
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return { ok: true, messageId: svixId }
    }
  }

  return { ok: false, reason: 'invalid_signature' }
}

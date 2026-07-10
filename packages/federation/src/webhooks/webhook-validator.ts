import crypto from 'node:crypto'

export function validateWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  const normalizedSig = signature.startsWith('sha256=') ? signature.slice(7) : signature

  // `timingSafeEqual` throws a RangeError when the two buffers differ in length,
  // so a signature that is not exactly `expected.length` hex chars would surface
  // as an unhandled 500 in the calling webhook route instead of a clean reject.
  // Guard the length first (mirrors `validateMadfamSignature` below).
  if (normalizedSig.length !== expected.length) {
    return false
  }

  return crypto.timingSafeEqual(Buffer.from(normalizedSig), Buffer.from(expected))
}

export interface MadfamSignatureResult {
  ok: boolean
  /** Populated only on failure. Never include the secret or the signature. */
  reason?:
    | 'missing_signature'
    | 'missing_secret'
    | 'malformed_header'
    | 'invalid_timestamp'
    | 'replay_window_exceeded'
    | 'signature_mismatch'
}

/**
 * Verify the `x-madfam-signature: t=<unix-seconds>,v1=<hex>` header used by
 * the RouteCraft payment emitter and the ecosystem revenue-loop probe.
 *
 * The HMAC covers `"${ts}.${rawBody}"` (Stripe's approach) so a stale
 * body replayed outside the replay window is rejected even if the
 * HMAC itself is structurally valid.
 *
 * Replay window defaults to 5 minutes. Pass `now` + `maxAgeMs` for tests.
 */
export function validateMadfamSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string | null | undefined,
  opts: { now?: number; maxAgeMs?: number } = {},
): MadfamSignatureResult {
  if (!secret) return { ok: false, reason: 'missing_secret' }
  if (!header) return { ok: false, reason: 'missing_signature' }

  const parts = header.split(',').map((p) => p.trim())
  const tsPart = parts.find((p) => p.startsWith('t='))
  const sigPart = parts.find((p) => p.startsWith('v1='))
  if (!tsPart || !sigPart) return { ok: false, reason: 'malformed_header' }

  const ts = Number(tsPart.slice(2))
  const received = sigPart.slice(3)
  if (!Number.isFinite(ts) || ts <= 0 || !received) {
    return { ok: false, reason: 'invalid_timestamp' }
  }

  const now = opts.now ?? Date.now()
  const maxAgeMs = opts.maxAgeMs ?? 5 * 60 * 1000
  const ageMs = now - ts * 1000
  if (ageMs < -maxAgeMs || ageMs > maxAgeMs) {
    return { ok: false, reason: 'replay_window_exceeded' }
  }

  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')
  if (received.length !== expected.length) {
    return { ok: false, reason: 'signature_mismatch' }
  }
  const match = crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  return match ? { ok: true } : { ok: false, reason: 'signature_mismatch' }
}

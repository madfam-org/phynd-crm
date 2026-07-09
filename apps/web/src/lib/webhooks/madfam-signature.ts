/**
 * MADFAM ecosystem signature verifier — PhyndCRM side.
 *
 * Mirrors the verifier in `dhanam/apps/api/src/modules/billing/madfam-events.sig.ts`
 * so the two receivers accept exactly the same inputs. If you change the
 * format, change both — there's a deliberate comment in each file pointing
 * at the other.
 *
 * Signature:
 *     x-madfam-signature: t=<unix-seconds>,v1=<hex-hmac-sha256>
 * HMAC input:
 *     `${ts}.${rawBody}`
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export const DEFAULT_REPLAY_WINDOW_SECONDS = 5 * 60

export type SignatureFailureReason =
  | 'missing_secret'
  | 'missing_signature_header'
  | 'malformed_signature_header'
  | 'non_numeric_timestamp'
  | 'replay_out_of_window'
  | 'signature_mismatch'

export interface SignatureResult {
  ok: boolean
  reason?: SignatureFailureReason
}

function parseSignatureHeader(signatureHeader: string): Record<string, string> {
  const parts: Record<string, string> = {}
  for (const seg of signatureHeader.split(',')) {
    const eq = seg.indexOf('=')
    if (eq === -1) continue
    const k = seg.slice(0, eq).trim()
    const v = seg.slice(eq + 1).trim()
    if (k && v) parts[k] = v
  }
  return parts
}

export function verifyMadfamSignature(
  rawBody: string,
  signatureHeader: string | undefined | null,
  secret: string | string[],
  opts: { nowSec?: number; replayWindowSec?: number } = {},
): SignatureResult {
  const secrets = (Array.isArray(secret) ? secret : [secret]).filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  )
  if (secrets.length === 0) return { ok: false, reason: 'missing_secret' }
  if (!signatureHeader) return { ok: false, reason: 'missing_signature_header' }

  const parts = parseSignatureHeader(signatureHeader)
  const tsStr = parts.t
  const v1 = parts.v1
  if (!tsStr || !v1) return { ok: false, reason: 'malformed_signature_header' }

  const ts = Number(tsStr)
  if (!Number.isFinite(ts)) return { ok: false, reason: 'non_numeric_timestamp' }

  const replayWindow = opts.replayWindowSec ?? DEFAULT_REPLAY_WINDOW_SECONDS
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - ts) > replayWindow) {
    return { ok: false, reason: 'replay_out_of_window' }
  }

  if (!/^[0-9a-fA-F]+$/.test(v1)) {
    return { ok: false, reason: 'signature_mismatch' }
  }

  // Accept the signature if it verifies against ANY configured secret. During a
  // rotation window the caller passes [current, previous] so a briefly-stale
  // emitter still verifies; outside a rotation it is just the current secret.
  const receivedBuf = Buffer.from(v1, 'hex')
  for (const s of secrets) {
    const expected = createHmac('sha256', s).update(`${ts}.${rawBody}`).digest('hex')
    const expectedBuf = Buffer.from(expected, 'hex')
    if (expectedBuf.length === receivedBuf.length && timingSafeEqual(expectedBuf, receivedBuf)) {
      return { ok: true }
    }
  }
  return { ok: false, reason: 'signature_mismatch' }
}

/**
 * Ordered secret list for a rotation window: current first, then an optional
 * previous secret. Empty and duplicate entries are dropped. During a rotation
 * pass both (so a briefly-stale emitter still verifies); outside one, pass just
 * the current secret. Keeps the zero-downtime rotation contract in one place —
 * see `runbooks/2026-07-08-event-bus-reliability.md` in internal-devops.
 */
export function rotationSecrets(
  current: string | undefined | null,
  previous?: string | undefined | null,
): string[] {
  const out: string[] = []
  for (const s of [current, previous]) {
    if (typeof s === 'string' && s.length > 0 && !out.includes(s)) out.push(s)
  }
  return out
}

export function signMadfamBody(
  rawBody: string,
  secret: string,
  ts: number = Math.floor(Date.now() / 1000),
): string {
  const hmac = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')
  return `t=${ts},v1=${hmac}`
}

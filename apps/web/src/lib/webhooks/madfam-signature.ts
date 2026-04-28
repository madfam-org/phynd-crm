/**
 * MADFAM ecosystem signature verifier — PhyneCRM side.
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

export function verifyMadfamSignature(
  rawBody: string,
  signatureHeader: string | undefined | null,
  secret: string,
  opts: { nowSec?: number; replayWindowSec?: number } = {},
): SignatureResult {
  if (!secret) return { ok: false, reason: 'missing_secret' }
  if (!signatureHeader) return { ok: false, reason: 'missing_signature_header' }

  const parts: Record<string, string> = {}
  for (const seg of signatureHeader.split(',')) {
    const eq = seg.indexOf('=')
    if (eq === -1) continue
    const k = seg.slice(0, eq).trim()
    const v = seg.slice(eq + 1).trim()
    if (k && v) parts[k] = v
  }

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

  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')

  const expectedBuf = Buffer.from(expected, 'hex')
  const receivedBuf = Buffer.from(v1, 'hex')
  if (expectedBuf.length !== receivedBuf.length) {
    return { ok: false, reason: 'signature_mismatch' }
  }
  if (!timingSafeEqual(expectedBuf, receivedBuf)) {
    return { ok: false, reason: 'signature_mismatch' }
  }
  return { ok: true }
}

export function signMadfamBody(
  rawBody: string,
  secret: string,
  ts: number = Math.floor(Date.now() / 1000),
): string {
  const hmac = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')
  return `t=${ts},v1=${hmac}`
}

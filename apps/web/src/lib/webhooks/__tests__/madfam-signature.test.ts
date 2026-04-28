/**
 * Tests for the MADFAM ecosystem signature verifier (PhyneCRM side).
 *
 * These mirror the tests in
 *   dhanam/apps/api/src/modules/billing/__tests__/madfam-events.sig.spec.ts
 * exactly. When changing the verifier, change both — drift between the
 * two receivers silently breaks the revenue-loop probe.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REPLAY_WINDOW_SECONDS,
  signMadfamBody,
  verifyMadfamSignature,
} from '../madfam-signature'

const SECRET = 's3cret-for-tests'
const BODY = JSON.stringify({ event_id: 'evt_1', amount_minor: 49900 })
const NOW = 1_800_000_000

describe('verifyMadfamSignature', () => {
  it('accepts a valid current-timestamp signature', () => {
    const header = signMadfamBody(BODY, SECRET, NOW)
    expect(verifyMadfamSignature(BODY, header, SECRET, { nowSec: NOW })).toEqual({ ok: true })
  })

  it('rejects when secret is empty', () => {
    const header = signMadfamBody(BODY, SECRET, NOW)
    expect(verifyMadfamSignature(BODY, header, '', { nowSec: NOW })).toEqual({
      ok: false,
      reason: 'missing_secret',
    })
  })

  it('rejects when header is missing (undefined/null/empty)', () => {
    for (const empty of [undefined, null, '']) {
      expect(verifyMadfamSignature(BODY, empty, SECRET, { nowSec: NOW })).toEqual({
        ok: false,
        reason: 'missing_signature_header',
      })
    }
  })

  it('rejects malformed headers (missing t or v1)', () => {
    for (const bad of [`t=${NOW}`, 'v1=abc', 'foo=bar,baz=qux']) {
      expect(verifyMadfamSignature(BODY, bad, SECRET, { nowSec: NOW })).toEqual({
        ok: false,
        reason: 'malformed_signature_header',
      })
    }
  })

  it('rejects non-numeric timestamps', () => {
    const hexOnly = signMadfamBody(BODY, SECRET, NOW).split(',')[1]?.slice(3)
    expect(
      verifyMadfamSignature(BODY, `t=tuesday,v1=${hexOnly}`, SECRET, {
        nowSec: NOW,
      }),
    ).toEqual({ ok: false, reason: 'non_numeric_timestamp' })
  })

  it('rejects timestamps outside the replay window (past)', () => {
    const header = signMadfamBody(BODY, SECRET, NOW - DEFAULT_REPLAY_WINDOW_SECONDS - 1)
    expect(verifyMadfamSignature(BODY, header, SECRET, { nowSec: NOW })).toEqual({
      ok: false,
      reason: 'replay_out_of_window',
    })
  })

  it('rejects timestamps outside the replay window (future)', () => {
    const header = signMadfamBody(BODY, SECRET, NOW + DEFAULT_REPLAY_WINDOW_SECONDS + 1)
    expect(verifyMadfamSignature(BODY, header, SECRET, { nowSec: NOW })).toEqual({
      ok: false,
      reason: 'replay_out_of_window',
    })
  })

  it('accepts timestamps exactly at the window edge', () => {
    const header = signMadfamBody(BODY, SECRET, NOW - DEFAULT_REPLAY_WINDOW_SECONDS)
    expect(verifyMadfamSignature(BODY, header, SECRET, { nowSec: NOW })).toEqual({ ok: true })
  })

  it('rejects non-hex v1 (prevents Buffer.from truncation)', () => {
    expect(
      verifyMadfamSignature(BODY, `t=${NOW},v1=not-hex-!!`, SECRET, {
        nowSec: NOW,
      }),
    ).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('rejects signed-with-wrong-secret', () => {
    const header = signMadfamBody(BODY, 'other-secret', NOW)
    expect(verifyMadfamSignature(BODY, header, SECRET, { nowSec: NOW })).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    })
  })

  it('rejects signed-over-wrong-body', () => {
    const header = signMadfamBody('different body', SECRET, NOW)
    expect(verifyMadfamSignature(BODY, header, SECRET, { nowSec: NOW })).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    })
  })

  it('handles length-mismatched v1 safely', () => {
    expect(
      verifyMadfamSignature(BODY, `t=${NOW},v1=abc123`, SECRET, {
        nowSec: NOW,
      }),
    ).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('tolerates extra unknown fields in the header', () => {
    const header = `${signMadfamBody(BODY, SECRET, NOW)},kid=2026-01`
    expect(verifyMadfamSignature(BODY, header, SECRET, { nowSec: NOW })).toEqual({ ok: true })
  })

  it('tolerates whitespace around segments', () => {
    const header = signMadfamBody(BODY, SECRET, NOW)
      .split(',')
      .map((s) => `  ${s}  `)
      .join(', ')
    expect(verifyMadfamSignature(BODY, header, SECRET, { nowSec: NOW })).toEqual({ ok: true })
  })

  it('honours a custom replay window', () => {
    const header = signMadfamBody(BODY, SECRET, NOW - 10)
    expect(
      verifyMadfamSignature(BODY, header, SECRET, {
        nowSec: NOW,
        replayWindowSec: 5,
      }),
    ).toEqual({ ok: false, reason: 'replay_out_of_window' })
    expect(
      verifyMadfamSignature(BODY, header, SECRET, {
        nowSec: NOW,
        replayWindowSec: 60,
      }),
    ).toEqual({ ok: true })
  })
})

describe('signMadfamBody', () => {
  it('produces the t=<ts>,v1=<hex> shape', () => {
    const s = signMadfamBody(BODY, SECRET, NOW)
    expect(s).toMatch(new RegExp(`^t=${NOW},v1=[0-9a-f]{64}$`))
  })

  it('is deterministic', () => {
    expect(signMadfamBody(BODY, SECRET, NOW)).toBe(signMadfamBody(BODY, SECRET, NOW))
  })

  it('round-trips cleanly through the verifier', () => {
    const header = signMadfamBody(BODY, SECRET, NOW)
    expect(verifyMadfamSignature(BODY, header, SECRET, { nowSec: NOW })).toEqual({ ok: true })
  })
})

/**
 * Tests for the MADFAM ecosystem signature verifier (PhyndCRM side).
 *
 * These mirror the tests in
 *   dhanam/apps/api/src/modules/billing/__tests__/madfam-events.sig.spec.ts
 * exactly. When changing the verifier, change both — drift between the
 * two receivers silently breaks the revenue-loop probe.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REPLAY_WINDOW_SECONDS,
  rotationSecrets,
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
    const [, signaturePart = ''] = signMadfamBody(BODY, SECRET, NOW).split(',')
    const hexOnly = signaturePart.slice(3)
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

describe('dual-secret rotation window', () => {
  const CURRENT = 'current-secret'
  const PREVIOUS = 'previous-secret'

  it('accepts a signature made with either the current or the previous secret', () => {
    const secrets = [CURRENT, PREVIOUS]
    const signedNew = signMadfamBody(BODY, CURRENT, NOW)
    const signedOld = signMadfamBody(BODY, PREVIOUS, NOW)
    expect(verifyMadfamSignature(BODY, signedNew, secrets, { nowSec: NOW })).toEqual({ ok: true })
    expect(verifyMadfamSignature(BODY, signedOld, secrets, { nowSec: NOW })).toEqual({ ok: true })
  })

  it('rejects a signature made with a secret not in the set', () => {
    const header = signMadfamBody(BODY, 'some-other-secret', NOW)
    expect(verifyMadfamSignature(BODY, header, [CURRENT, PREVIOUS], { nowSec: NOW })).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    })
  })

  it('rejects when the secret list is empty', () => {
    const header = signMadfamBody(BODY, CURRENT, NOW)
    expect(verifyMadfamSignature(BODY, header, [], { nowSec: NOW })).toEqual({
      ok: false,
      reason: 'missing_secret',
    })
  })

  it('single-string secret still works (backward compatible)', () => {
    const header = signMadfamBody(BODY, CURRENT, NOW)
    expect(verifyMadfamSignature(BODY, header, CURRENT, { nowSec: NOW })).toEqual({ ok: true })
  })
})

describe('rotationSecrets', () => {
  it('returns [current] when no previous is set', () => {
    expect(rotationSecrets('a')).toEqual(['a'])
    expect(rotationSecrets('a', undefined)).toEqual(['a'])
    expect(rotationSecrets('a', '')).toEqual(['a'])
  })

  it('returns [current, previous] in order during a rotation', () => {
    expect(rotationSecrets('a', 'b')).toEqual(['a', 'b'])
  })

  it('drops empty/undefined and de-duplicates', () => {
    expect(rotationSecrets(undefined, undefined)).toEqual([])
    expect(rotationSecrets('', 'b')).toEqual(['b'])
    expect(rotationSecrets('a', 'a')).toEqual(['a'])
  })
})

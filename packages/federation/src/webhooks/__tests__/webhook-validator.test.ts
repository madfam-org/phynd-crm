import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validateMadfamSignature, validateWebhookSignature } from '../webhook-validator'

/**
 * Helper: compute a valid HMAC-SHA256 hex digest for a given payload + secret
 */
function computeSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

describe('validateWebhookSignature', () => {
  const SECRET = 'whsec_test_secret_key_2026'

  it('returns true for a valid HMAC-SHA256 signature', () => {
    const payload = JSON.stringify({ event: 'invoice.paid', id: 'inv_123' })
    const signature = computeSignature(payload, SECRET)

    expect(validateWebhookSignature(payload, signature, SECRET)).toBe(true)
  })

  it('returns true for a valid signature with a different payload', () => {
    const payload = JSON.stringify({
      event: 'user.created',
      userId: 'usr_456',
    })
    const signature = computeSignature(payload, SECRET)

    expect(validateWebhookSignature(payload, signature, SECRET)).toBe(true)
  })

  it('returns false for an invalid signature (wrong signature value)', () => {
    const payload = JSON.stringify({ event: 'invoice.paid', id: 'inv_123' })
    // Fabricate a wrong signature of the correct length (64 hex chars)
    const wrongSignature = 'a'.repeat(64)

    expect(validateWebhookSignature(payload, wrongSignature, SECRET)).toBe(false)
  })

  it('returns false when the signature was computed with a different secret', () => {
    const payload = JSON.stringify({ event: 'invoice.paid', id: 'inv_123' })
    const signatureWithWrongSecret = computeSignature(payload, 'wrong_secret')

    expect(validateWebhookSignature(payload, signatureWithWrongSecret, SECRET)).toBe(false)
  })

  it('returns false for a tampered payload (modified body after signing)', () => {
    const originalPayload = JSON.stringify({
      event: 'invoice.paid',
      id: 'inv_123',
      amount: 100,
    })
    const signature = computeSignature(originalPayload, SECRET)

    // Tamper with the payload after signing
    const tamperedPayload = JSON.stringify({
      event: 'invoice.paid',
      id: 'inv_123',
      amount: 999,
    })

    expect(validateWebhookSignature(tamperedPayload, signature, SECRET)).toBe(false)
  })

  it('returns false when even a single character of the payload is changed', () => {
    const payload = 'exact-payload-string'
    const signature = computeSignature(payload, SECRET)

    const alteredPayload = 'exact-payload-strinG' // last char changed
    expect(validateWebhookSignature(alteredPayload, signature, SECRET)).toBe(false)
  })

  it('validates an empty payload correctly', () => {
    const payload = ''
    const signature = computeSignature(payload, SECRET)

    expect(validateWebhookSignature(payload, signature, SECRET)).toBe(true)
  })

  it('returns true for a valid signature with sha256= prefix (Tezca/Fortuna format)', () => {
    const payload = JSON.stringify({ event: 'interest.created', email: 'test@example.com' })
    const rawSignature = computeSignature(payload, SECRET)
    const prefixedSignature = `sha256=${rawSignature}`

    expect(validateWebhookSignature(payload, prefixedSignature, SECRET)).toBe(true)
  })

  it('returns false for an invalid signature with sha256= prefix', () => {
    const payload = JSON.stringify({ event: 'interest.created', email: 'test@example.com' })
    const wrongPrefixedSignature = `sha256=${'b'.repeat(64)}`

    expect(validateWebhookSignature(payload, wrongPrefixedSignature, SECRET)).toBe(false)
  })

  it('throws when signature length does not match expected HMAC length', () => {
    const payload = JSON.stringify({ event: 'test' })
    const signature = computeSignature(payload, SECRET)
    const shortSignature = signature.slice(0, 32) // truncated to 32 chars

    // crypto.timingSafeEqual throws when buffer lengths differ
    expect(() => validateWebhookSignature(payload, shortSignature, SECRET)).toThrow()
  })
})

describe('validateMadfamSignature', () => {
  const SECRET = 'whsec_madfam_test_secret_2026'

  function madfamHeader(body: string, secret: string, ts: number): string {
    const hmac = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
    return `t=${ts},v1=${hmac}`
  }

  it('accepts a fresh, correctly-signed header', () => {
    const body = JSON.stringify({ event_id: 'evt_1', amount_minor: 12000 })
    const ts = Math.floor(Date.now() / 1000)
    const header = madfamHeader(body, SECRET, ts)

    expect(validateMadfamSignature(body, header, SECRET).ok).toBe(true)
  })

  it('rejects a missing secret', () => {
    const result = validateMadfamSignature('{}', 't=1,v1=abc', '')
    expect(result).toEqual({ ok: false, reason: 'missing_secret' })
  })

  it('rejects a missing header', () => {
    expect(validateMadfamSignature('{}', null, SECRET)).toEqual({
      ok: false,
      reason: 'missing_signature',
    })
  })

  it('rejects a malformed header (no v1= part)', () => {
    expect(validateMadfamSignature('{}', 't=1700000000', SECRET)).toEqual({
      ok: false,
      reason: 'malformed_header',
    })
  })

  it('rejects a non-numeric timestamp', () => {
    expect(validateMadfamSignature('{}', 't=abc,v1=deadbeef', SECRET)).toEqual({
      ok: false,
      reason: 'invalid_timestamp',
    })
  })

  it('rejects a replayed header outside the 5-minute window', () => {
    const body = JSON.stringify({ event_id: 'evt_stale' })
    const ts = Math.floor(Date.now() / 1000) - 10 * 60 // 10 min old
    const header = madfamHeader(body, SECRET, ts)

    const result = validateMadfamSignature(body, header, SECRET)
    expect(result).toEqual({ ok: false, reason: 'replay_window_exceeded' })
  })

  it('rejects a wrong signature value at the right length', () => {
    const body = JSON.stringify({ event_id: 'evt_1' })
    const ts = Math.floor(Date.now() / 1000)
    const header = `t=${ts},v1=${'a'.repeat(64)}`

    expect(validateMadfamSignature(body, header, SECRET)).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    })
  })

  it('rejects a tampered body after signing', () => {
    const original = JSON.stringify({ event_id: 'evt_1', amount_minor: 12000 })
    const ts = Math.floor(Date.now() / 1000)
    const header = madfamHeader(original, SECRET, ts)

    const tampered = JSON.stringify({ event_id: 'evt_1', amount_minor: 99999 })
    expect(validateMadfamSignature(tampered, header, SECRET)).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    })
  })

  it('rejects a signature of wrong length without throwing', () => {
    const body = JSON.stringify({ event_id: 'evt_1' })
    const ts = Math.floor(Date.now() / 1000)
    // Truncated v1 — regression guard against crypto.timingSafeEqual throwing
    const header = `t=${ts},v1=${'deadbeef'}`

    expect(() => validateMadfamSignature(body, header, SECRET)).not.toThrow()
    expect(validateMadfamSignature(body, header, SECRET)).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    })
  })

  it('honours a custom `now` + `maxAgeMs` for tests', () => {
    const body = JSON.stringify({ event_id: 'evt_old_but_ok' })
    const ts = 1_700_000_000
    const header = madfamHeader(body, SECRET, ts)

    // Within a 10-minute window relative to a fake `now`:
    const now = ts * 1000 + 4 * 60 * 1000
    expect(
      validateMadfamSignature(body, header, SECRET, { now, maxAgeMs: 10 * 60 * 1000 }).ok,
    ).toBe(true)

    // Outside:
    expect(
      validateMadfamSignature(body, header, SECRET, {
        now: now + 10 * 60 * 1000,
        maxAgeMs: 60 * 1000,
      }),
    ).toEqual({ ok: false, reason: 'replay_window_exceeded' })
  })
})

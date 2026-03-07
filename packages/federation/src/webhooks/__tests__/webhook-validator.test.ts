import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validateWebhookSignature } from '../webhook-validator'

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

  it('throws when signature length does not match expected HMAC length', () => {
    const payload = JSON.stringify({ event: 'test' })
    const signature = computeSignature(payload, SECRET)
    const shortSignature = signature.slice(0, 32) // truncated to 32 chars

    // crypto.timingSafeEqual throws when buffer lengths differ
    expect(() => validateWebhookSignature(payload, shortSignature, SECRET)).toThrow()
  })
})

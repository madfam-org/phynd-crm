import { createHmac, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifySvixSignature } from '../svix'

const KEY = randomBytes(24)
const SECRET = `whsec_${KEY.toString('base64')}`

function sign(body: string, id: string, timestamp: string, key: Buffer = KEY): string {
  const digest = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
  return `v1,${digest}`
}

function nowSeconds(offsetMs = 0): string {
  return String(Math.floor((Date.now() + offsetMs) / 1000))
}

describe('verifySvixSignature', () => {
  const body = JSON.stringify({ type: 'email.opened', data: { email_id: 're_123' } })

  it('accepts a valid signature', () => {
    const timestamp = nowSeconds()
    const result = verifySvixSignature(
      body,
      {
        svixId: 'msg_abc',
        svixTimestamp: timestamp,
        svixSignature: sign(body, 'msg_abc', timestamp),
      },
      SECRET,
    )
    expect(result).toEqual({ ok: true, messageId: 'msg_abc' })
  })

  it('accepts when any of the space-separated signatures matches (key rotation)', () => {
    const timestamp = nowSeconds()
    const stale = sign(body, 'msg_abc', timestamp, randomBytes(24))
    const valid = sign(body, 'msg_abc', timestamp)
    const result = verifySvixSignature(
      body,
      { svixId: 'msg_abc', svixTimestamp: timestamp, svixSignature: `${stale} ${valid}` },
      SECRET,
    )
    expect(result.ok).toBe(true)
  })

  it('rejects a signature made with the wrong key', () => {
    const timestamp = nowSeconds()
    const result = verifySvixSignature(
      body,
      {
        svixId: 'msg_abc',
        svixTimestamp: timestamp,
        svixSignature: sign(body, 'msg_abc', timestamp, randomBytes(24)),
      },
      SECRET,
    )
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('rejects a tampered body', () => {
    const timestamp = nowSeconds()
    const result = verifySvixSignature(
      `${body} `,
      {
        svixId: 'msg_abc',
        svixTimestamp: timestamp,
        svixSignature: sign(body, 'msg_abc', timestamp),
      },
      SECRET,
    )
    expect(result.ok).toBe(false)
  })

  it('rejects timestamps outside the 5-minute tolerance', () => {
    const timestamp = nowSeconds(-6 * 60 * 1000)
    const result = verifySvixSignature(
      body,
      {
        svixId: 'msg_abc',
        svixTimestamp: timestamp,
        svixSignature: sign(body, 'msg_abc', timestamp),
      },
      SECRET,
    )
    expect(result).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' })
  })

  it('rejects missing headers', () => {
    const result = verifySvixSignature(
      body,
      { svixId: null, svixTimestamp: null, svixSignature: null },
      SECRET,
    )
    expect(result).toEqual({ ok: false, reason: 'missing_headers' })
  })

  it('works with an un-prefixed base64 secret', () => {
    const timestamp = nowSeconds()
    const result = verifySvixSignature(
      body,
      {
        svixId: 'msg_abc',
        svixTimestamp: timestamp,
        svixSignature: sign(body, 'msg_abc', timestamp),
      },
      KEY.toString('base64'),
    )
    expect(result.ok).toBe(true)
  })
})

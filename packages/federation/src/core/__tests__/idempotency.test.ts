import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateIdempotencyKey } from '../idempotency'

describe('generateIdempotencyKey', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('generates consistent key for the same inputs within the same time bucket', () => {
    // Pin time at an arbitrary point
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'))

    const key1 = generateIdempotencyKey('dhanam', 'createInvoice', 'ext-123')
    const key2 = generateIdempotencyKey('dhanam', 'createInvoice', 'ext-123')

    expect(key1).toBe(key2)
  })

  it('generates different keys for different providers', () => {
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'))

    const keyDhanam = generateIdempotencyKey('dhanam', 'createInvoice', 'ext-123')
    const keyCotiza = generateIdempotencyKey('cotiza', 'createInvoice', 'ext-123')

    expect(keyDhanam).not.toBe(keyCotiza)
  })

  it('generates different keys for different external IDs', () => {
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'))

    const key1 = generateIdempotencyKey('dhanam', 'createInvoice', 'ext-111')
    const key2 = generateIdempotencyKey('dhanam', 'createInvoice', 'ext-222')

    expect(key1).not.toBe(key2)
  })

  it('generates different keys for different methods', () => {
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'))

    const keyCreate = generateIdempotencyKey('dhanam', 'createInvoice', 'ext-123')
    const keyDelete = generateIdempotencyKey('dhanam', 'deleteInvoice', 'ext-123')

    expect(keyCreate).not.toBe(keyDelete)
  })

  it('returns a valid SHA-256 hex string (64 characters)', () => {
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'))

    const key = generateIdempotencyKey('janua', 'getUser', 'usr-001')

    expect(key).toHaveLength(64)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates different keys when the time bucket changes', () => {
    // First call at T=0
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'))
    const key1 = generateIdempotencyKey('dhanam', 'createInvoice', 'ext-123')

    // Advance past the 5-minute bucket boundary
    vi.setSystemTime(new Date('2026-01-15T10:06:00Z'))
    const key2 = generateIdempotencyKey('dhanam', 'createInvoice', 'ext-123')

    expect(key1).not.toBe(key2)
  })

  it('generates the same key within a 5-minute bucket boundary', () => {
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'))
    const key1 = generateIdempotencyKey('dhanam', 'createInvoice', 'ext-123')

    // Still within the same 5-minute bucket (< 5 minutes later)
    vi.setSystemTime(new Date('2026-01-15T10:04:59Z'))
    const key2 = generateIdempotencyKey('dhanam', 'createInvoice', 'ext-123')

    expect(key1).toBe(key2)
  })
})

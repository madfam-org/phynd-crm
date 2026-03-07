import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { calculateDelay, isRetryableError, withRetry, DEFAULT_RETRY_CONFIG } from '../retry'
import type { RetryConfig } from '@phyne/types/federation'

// ---------------------------------------------------------------------------
// calculateDelay
// ---------------------------------------------------------------------------
describe('calculateDelay', () => {
  it('returns a value within the expected exponential + jitter range', () => {
    // attempt 0: exponential = 500 * 2^0 = 500
    // jitter range: 0 to 500 * 0.5 = 250
    // total range: 500 to 750
    const delay = calculateDelay(0, DEFAULT_RETRY_CONFIG)
    expect(delay).toBeGreaterThanOrEqual(500)
    expect(delay).toBeLessThanOrEqual(750)
  })

  it('scales exponentially for higher attempts', () => {
    // attempt 2: exponential = 500 * 2^2 = 2000
    // jitter range: 0 to 2000 * 0.5 = 1000
    // total range: 2000 to 3000
    const delay = calculateDelay(2, DEFAULT_RETRY_CONFIG)
    expect(delay).toBeGreaterThanOrEqual(2000)
    expect(delay).toBeLessThanOrEqual(3000)
  })

  it('caps delay at maxDelayMs', () => {
    const config: RetryConfig = {
      maxRetries: 10,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      jitterFactor: 0.5,
    }
    // attempt 10: exponential = 1000 * 2^10 = 1_024_000 -> capped at 5000
    // jitter range: 0 to 5000 * 0.5 = 2500
    // total range: 5000 to 7500
    const delay = calculateDelay(10, config)
    expect(delay).toBeGreaterThanOrEqual(5000)
    expect(delay).toBeLessThanOrEqual(7500)
  })

  it('returns deterministic delay when jitterFactor is 0', () => {
    const config: RetryConfig = {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 10000,
      jitterFactor: 0,
    }
    // attempt 1: exponential = 100 * 2^1 = 200, jitter = 0
    expect(calculateDelay(1, config)).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// isRetryableError
// ---------------------------------------------------------------------------
describe('isRetryableError', () => {
  it('returns true for a timeout error', () => {
    expect(isRetryableError(new Error('Request timeout'))).toBe(true)
  })

  it('returns true for an ECONNRESET error', () => {
    expect(isRetryableError(new Error('socket hang up: ECONNRESET'))).toBe(true)
  })

  it('returns true for an ECONNREFUSED error', () => {
    expect(isRetryableError(new Error('connect ECONNREFUSED 127.0.0.1:3000'))).toBe(true)
  })

  it('returns true for HTTP 500 status', () => {
    expect(isRetryableError({ status: 500 })).toBe(true)
  })

  it('returns true for HTTP 502 status', () => {
    expect(isRetryableError({ status: 502 })).toBe(true)
  })

  it('returns true for HTTP 503 status', () => {
    expect(isRetryableError({ status: 503 })).toBe(true)
  })

  it('returns true for HTTP 408 (Request Timeout) status', () => {
    expect(isRetryableError({ status: 408 })).toBe(true)
  })

  it('returns true for HTTP 429 (Too Many Requests) status', () => {
    expect(isRetryableError({ status: 429 })).toBe(true)
  })

  it('returns false for HTTP 400 (Bad Request) status', () => {
    expect(isRetryableError({ status: 400 })).toBe(false)
  })

  it('returns false for HTTP 404 (Not Found) status', () => {
    expect(isRetryableError({ status: 404 })).toBe(false)
  })

  it('returns false for HTTP 401 (Unauthorized) status', () => {
    expect(isRetryableError({ status: 401 })).toBe(false)
  })

  it('returns false for a generic non-network Error', () => {
    expect(isRetryableError(new Error('validation failed'))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isRetryableError(null)).toBe(false)
  })

  it('returns false for a string', () => {
    expect(isRetryableError('something went wrong')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------
describe('withRetry', () => {
  const FAST_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1,
    maxDelayMs: 10,
    jitterFactor: 0,
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('succeeds on first attempt without retrying', async () => {
    const fn = vi.fn().mockResolvedValueOnce('success')

    const resultPromise = withRetry(fn, FAST_CONFIG)
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on a transient failure then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce('recovered')

    const resultPromise = withRetry(fn, FAST_CONFIG)
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws after max retries are exhausted', async () => {
    const retryableError = new Error('timeout')
    const fn = vi.fn().mockRejectedValue(retryableError)

    // Attach the rejection handler BEFORE flushing timers so the
    // rejection is always caught and doesn't surface as unhandled.
    const assertion = expect(withRetry(fn, FAST_CONFIG)).rejects.toThrow('timeout')
    await vi.runAllTimersAsync()
    await assertion

    // maxRetries=3 means 1 initial + 3 retries = 4 total calls
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('throws immediately on a non-retryable error without retrying', async () => {
    const nonRetryableError = new Error('validation failed')
    const fn = vi.fn().mockRejectedValueOnce(nonRetryableError)

    const assertion = expect(withRetry(fn, FAST_CONFIG)).rejects.toThrow('validation failed')
    await vi.runAllTimersAsync()
    await assertion

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws immediately on a non-retryable status code error', async () => {
    const clientError = Object.assign(new Error('not found'), { status: 404 })
    const fn = vi.fn().mockRejectedValueOnce(clientError)

    const assertion = expect(withRetry(fn, FAST_CONFIG)).rejects.toThrow('not found')
    await vi.runAllTimersAsync()
    await assertion

    expect(fn).toHaveBeenCalledTimes(1)
  })
})

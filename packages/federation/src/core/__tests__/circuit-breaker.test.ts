import type { CircuitBreakerConfig } from '@phynd/types/federation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CircuitBreaker, DEFAULT_CB_CONFIG } from '../circuit-breaker'

describe('CircuitBreaker', () => {
  const TEST_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 3,
    resetTimeoutMs: 1000,
    halfOpenSuccessThreshold: 2,
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------
  it('starts in CLOSED state', () => {
    const cb = new CircuitBreaker(TEST_CONFIG)
    expect(cb.getState()).toBe('closed')
  })

  // -----------------------------------------------------------------------
  // CLOSED behaviour
  // -----------------------------------------------------------------------
  it('stays CLOSED when recording successes', () => {
    const cb = new CircuitBreaker(TEST_CONFIG)
    cb.recordSuccess()
    cb.recordSuccess()
    cb.recordSuccess()
    expect(cb.getState()).toBe('closed')
  })

  it('stays CLOSED when failures are below threshold', () => {
    const cb = new CircuitBreaker(TEST_CONFIG)
    cb.recordFailure()
    cb.recordFailure()
    // 2 failures < threshold of 3
    expect(cb.getState()).toBe('closed')
  })

  it('resets failure count on success while CLOSED', () => {
    const cb = new CircuitBreaker(TEST_CONFIG)
    cb.recordFailure()
    cb.recordFailure()
    cb.recordSuccess() // resets failureCount to 0
    cb.recordFailure()
    cb.recordFailure()
    // only 2 failures since last success, still below threshold
    expect(cb.getState()).toBe('closed')
  })

  // -----------------------------------------------------------------------
  // CLOSED -> OPEN transition
  // -----------------------------------------------------------------------
  it('transitions from CLOSED to OPEN after reaching failure threshold', () => {
    const cb = new CircuitBreaker(TEST_CONFIG)
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure() // hits threshold of 3
    expect(cb.getState()).toBe('open')
  })

  it('reports isCallPermitted=false when OPEN', () => {
    const cb = new CircuitBreaker(TEST_CONFIG)
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.isCallPermitted()).toBe(false)
  })

  // -----------------------------------------------------------------------
  // OPEN -> HALF_OPEN transition
  // -----------------------------------------------------------------------
  it('transitions from OPEN to HALF_OPEN after reset timeout elapses', () => {
    const cb = new CircuitBreaker(TEST_CONFIG)

    // Trip the breaker
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.getState()).toBe('open')

    // Advance time past the reset timeout
    vi.advanceTimersByTime(TEST_CONFIG.resetTimeoutMs + 1)

    expect(cb.getState()).toBe('half_open')
    expect(cb.isCallPermitted()).toBe(true)
  })

  it('stays OPEN before the reset timeout elapses', () => {
    const cb = new CircuitBreaker(TEST_CONFIG)
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()

    vi.advanceTimersByTime(TEST_CONFIG.resetTimeoutMs - 1)
    expect(cb.getState()).toBe('open')
  })

  // -----------------------------------------------------------------------
  // HALF_OPEN -> CLOSED transition
  // -----------------------------------------------------------------------
  it('transitions from HALF_OPEN to CLOSED after reaching success threshold', () => {
    const cb = new CircuitBreaker(TEST_CONFIG)

    // Trip to OPEN
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()

    // Wait for HALF_OPEN -- must call getState() to trigger the
    // time-based OPEN->HALF_OPEN transition before recording successes
    vi.advanceTimersByTime(TEST_CONFIG.resetTimeoutMs + 1)
    expect(cb.getState()).toBe('half_open')

    // Record successes up to halfOpenSuccessThreshold
    cb.recordSuccess()
    expect(cb.getState()).toBe('half_open') // not yet at threshold
    cb.recordSuccess() // hits threshold of 2
    expect(cb.getState()).toBe('closed')
  })

  it('allows calls after transitioning HALF_OPEN to CLOSED', () => {
    const cb = new CircuitBreaker(TEST_CONFIG)

    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()

    // Must call getState() to trigger OPEN->HALF_OPEN before recording successes.
    // recordSuccess() checks `this.state` directly; without getState() the
    // internal state stays 'open' and the half_open branch never runs.
    vi.advanceTimersByTime(TEST_CONFIG.resetTimeoutMs + 1)
    expect(cb.getState()).toBe('half_open')

    cb.recordSuccess()
    cb.recordSuccess()

    expect(cb.isCallPermitted()).toBe(true)
    expect(cb.getState()).toBe('closed')
  })

  // -----------------------------------------------------------------------
  // HALF_OPEN -> OPEN transition
  // -----------------------------------------------------------------------
  it('transitions from HALF_OPEN back to OPEN on any failure', () => {
    const cb = new CircuitBreaker(TEST_CONFIG)

    // Trip to OPEN
    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()

    // Wait for HALF_OPEN
    vi.advanceTimersByTime(TEST_CONFIG.resetTimeoutMs + 1)
    expect(cb.getState()).toBe('half_open')

    // A single failure in HALF_OPEN should revert to OPEN
    cb.recordFailure()
    expect(cb.getState()).toBe('open')
    expect(cb.isCallPermitted()).toBe(false)
  })

  it('transitions HALF_OPEN to OPEN even after some successes followed by a failure', () => {
    const cb = new CircuitBreaker(TEST_CONFIG)

    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()

    vi.advanceTimersByTime(TEST_CONFIG.resetTimeoutMs + 1)
    expect(cb.getState()).toBe('half_open')

    cb.recordSuccess() // 1 success, below threshold of 2
    cb.recordFailure() // any failure in HALF_OPEN -> OPEN
    expect(cb.getState()).toBe('open')
  })

  // -----------------------------------------------------------------------
  // reset()
  // -----------------------------------------------------------------------
  it('reset() returns to initial CLOSED state from OPEN', () => {
    const cb = new CircuitBreaker(TEST_CONFIG)

    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.getState()).toBe('open')

    cb.reset()
    expect(cb.getState()).toBe('closed')
    expect(cb.isCallPermitted()).toBe(true)
  })

  it('reset() returns to initial CLOSED state from HALF_OPEN', () => {
    const cb = new CircuitBreaker(TEST_CONFIG)

    cb.recordFailure()
    cb.recordFailure()
    cb.recordFailure()

    vi.advanceTimersByTime(TEST_CONFIG.resetTimeoutMs + 1)
    expect(cb.getState()).toBe('half_open')

    cb.reset()
    expect(cb.getState()).toBe('closed')
    expect(cb.isCallPermitted()).toBe(true)
  })

  it('reset() clears failure history so threshold count restarts', () => {
    const cb = new CircuitBreaker(TEST_CONFIG)

    // Accumulate 2 failures (just below threshold)
    cb.recordFailure()
    cb.recordFailure()

    cb.reset()

    // After reset, 2 more failures should NOT trip the breaker
    // because the counter restarted
    cb.recordFailure()
    cb.recordFailure()
    expect(cb.getState()).toBe('closed')

    // Only a 3rd failure after reset should trip it
    cb.recordFailure()
    expect(cb.getState()).toBe('open')
  })

  // -----------------------------------------------------------------------
  // Default config
  // -----------------------------------------------------------------------
  it('uses sensible default configuration values', () => {
    expect(DEFAULT_CB_CONFIG.failureThreshold).toBe(5)
    expect(DEFAULT_CB_CONFIG.resetTimeoutMs).toBe(30000)
    expect(DEFAULT_CB_CONFIG.halfOpenSuccessThreshold).toBe(3)
  })
})

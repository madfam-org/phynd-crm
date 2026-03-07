import type { CircuitBreakerConfig, CircuitState } from '@phyne/types/federation'

export const DEFAULT_CB_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenSuccessThreshold: 3,
}

export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failureCount = 0
  private successCount = 0
  private lastFailureTime = 0
  private readonly config: CircuitBreakerConfig

  constructor(config: CircuitBreakerConfig = DEFAULT_CB_CONFIG) {
    this.config = config
  }

  getState(): CircuitState {
    if (this.state === 'open') {
      const now = Date.now()
      if (now - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.state = 'half_open'
        this.successCount = 0
      }
    }
    return this.state
  }

  isCallPermitted(): boolean {
    const currentState = this.getState()
    return currentState === 'closed' || currentState === 'half_open'
  }

  recordSuccess(): void {
    if (this.state === 'half_open') {
      this.successCount++
      if (this.successCount >= this.config.halfOpenSuccessThreshold) {
        this.state = 'closed'
        this.failureCount = 0
        this.successCount = 0
      }
    } else if (this.state === 'closed') {
      this.failureCount = 0
    }
  }

  recordFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()
    if (this.state === 'half_open') {
      this.state = 'open'
      this.successCount = 0
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open'
    }
  }

  reset(): void {
    this.state = 'closed'
    this.failureCount = 0
    this.successCount = 0
    this.lastFailureTime = 0
  }
}

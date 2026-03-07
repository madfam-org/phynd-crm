import type { RetryConfig } from '@phyne/types/federation'

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 30000,
  jitterFactor: 0.5,
}

export function calculateDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  const exponentialDelay = config.baseDelayMs * 2 ** attempt
  const capped = Math.min(exponentialDelay, config.maxDelayMs)
  const jitter = capped * config.jitterFactor * Math.random()
  return capped + jitter
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused')
    ) {
      return true
    }
  }
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status
    return status >= 500 || status === 408 || status === 429
  }
  return false
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === config.maxRetries || !isRetryableError(error)) {
        throw error
      }
      const delay = calculateDelay(attempt, config)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError
}

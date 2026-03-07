import type { ProviderConfig, ProviderStatus } from '@phyne/types/federation'
import type { CacheManager } from './cache-manager'
import { CircuitBreaker } from './circuit-breaker'
import { generateIdempotencyKey } from './idempotency'
import { withRetry } from './retry'
import type { FederationCallResult, FederationProvider } from './types'

export class FederationClient<TRaw, TMapped> {
  private readonly circuitBreaker: CircuitBreaker
  private readonly provider: FederationProvider<TRaw, TMapped>
  private readonly cache: CacheManager
  private readonly config: ProviderConfig

  constructor(
    provider: FederationProvider<TRaw, TMapped>,
    cache: CacheManager,
    config: ProviderConfig,
  ) {
    this.provider = provider
    this.cache = cache
    this.config = config
    this.circuitBreaker = new CircuitBreaker(config.circuitBreaker)
  }

  async fetch(
    externalId: string,
    token: string,
    tenantId = 'madfam',
  ): Promise<FederationCallResult<TMapped>> {
    // 1. Check cache
    const cacheKey = this.provider.getCacheKey(externalId, tenantId)
    const cached = await this.cache.get<TMapped>(this.config.cache.keyPrefix, cacheKey)
    if (cached) {
      return {
        data: cached.data,
        status: 'ok',
        cachedAt: cached.cachedAt,
        error: null,
      }
    }

    // 2. Check circuit breaker
    if (!this.circuitBreaker.isCallPermitted()) {
      const stale = await this.cache.getStale<TMapped>(this.config.cache.keyPrefix, cacheKey)
      return {
        data: stale,
        status: 'degraded',
        cachedAt: null,
        error: 'Circuit breaker open',
      }
    }

    // 3. Fetch with retry
    try {
      const _idempotencyKey = generateIdempotencyKey(this.provider.name, 'fetch', externalId)

      const raw = await withRetry(() => this.provider.fetch(externalId, token), this.config.retry)

      const mapped = this.provider.map(raw)

      // 4. Cache result
      await this.cache.set(
        this.config.cache.keyPrefix,
        cacheKey,
        mapped,
        this.config.cache.ttlSeconds,
      )

      this.circuitBreaker.recordSuccess()

      return {
        data: mapped,
        status: 'ok',
        cachedAt: new Date(),
        error: null,
      }
    } catch (error) {
      this.circuitBreaker.recordFailure()

      // Try stale cache
      const stale = await this.cache.getStale<TMapped>(this.config.cache.keyPrefix, cacheKey)
      const status: ProviderStatus = stale ? 'degraded' : 'unavailable'

      return {
        data: stale,
        status,
        cachedAt: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  getCircuitState() {
    return this.circuitBreaker.getState()
  }

  resetCircuitBreaker() {
    this.circuitBreaker.reset()
  }
}

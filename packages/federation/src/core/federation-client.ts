import type { ProviderConfig, ProviderStatus } from '@phynd/types/federation'
import type { CacheManager } from './cache-manager'
import { CircuitBreaker } from './circuit-breaker'
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
    circuitBreaker?: CircuitBreaker,
  ) {
    this.provider = provider
    this.cache = cache
    this.config = config
    this.circuitBreaker = circuitBreaker ?? new CircuitBreaker(config.circuitBreaker)
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
      const signal = AbortSignal.timeout(this.config.timeout ?? 10000)

      const raw = await withRetry(
        () => this.provider.fetch(externalId, token, signal),
        this.config.retry,
      )

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

  async mutate(
    externalId: string,
    payload: unknown,
    token: string,
    tenantId = 'madfam',
    idempotencyKey?: string,
  ): Promise<{ status: ProviderStatus; error: string | null }> {
    if (!this.provider.mutate) {
      return { status: 'ok', error: 'Mutation not supported by provider' }
    }

    if (!this.circuitBreaker.isCallPermitted()) {
      return { status: 'unavailable', error: 'Circuit breaker open' }
    }

    try {
      const signal = AbortSignal.timeout(this.config.timeout ?? 10000)
      await withRetry(
        () => this.provider.mutate!(externalId, payload, token, signal, idempotencyKey),
        this.config.retry,
      )

      this.circuitBreaker.recordSuccess()

      const cacheKey = this.provider.getCacheKey(externalId, tenantId)
      await this.cache.invalidate(this.config.cache.keyPrefix, cacheKey)

      return { status: 'ok', error: null }
    } catch (error) {
      this.circuitBreaker.recordFailure()
      return {
        status: 'unavailable',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}

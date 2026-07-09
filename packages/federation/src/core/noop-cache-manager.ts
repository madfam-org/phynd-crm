import type { CacheManagerLike } from './cache-manager'

/**
 * A cache that stores nothing. Use on request paths that build a
 * {@link import('../../../services/src/context').ServiceContext} but never
 * exercise federation caching (portal routes, webhook receivers), so the
 * `cache` field is satisfied honestly instead of with `{} as any`.
 *
 * Every read misses and every write is a no-op, which is the correct behaviour
 * for a context that has no Redis connection.
 */
export class NoopCacheManager implements CacheManagerLike {
  async get<T>(_prefix: string, _id: string): Promise<{ data: T; cachedAt: Date } | null> {
    return null
  }

  async set<T>(_prefix: string, _id: string, _data: T, _ttlSeconds: number): Promise<void> {
    // no-op
  }

  async invalidate(_prefix: string, _id: string): Promise<void> {
    // no-op
  }

  async invalidatePattern(_prefix: string): Promise<void> {
    // no-op
  }

  async getStale<T>(_prefix: string, _id: string): Promise<T | null> {
    return null
  }
}

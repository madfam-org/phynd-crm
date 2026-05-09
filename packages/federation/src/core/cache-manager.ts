import type Redis from 'ioredis'

export class CacheManager {
  private readonly staleKeySuffix = ':stale'

  constructor(
    private readonly redis: Redis,
    private readonly tenantId: string = 'madfam',
  ) {}

  private buildKey(prefix: string, id: string): string {
    return `phynd:${this.tenantId}:${prefix}:${id}`
  }

  private buildStaleKey(prefix: string, id: string): string {
    return `${this.buildKey(prefix, id)}${this.staleKeySuffix}`
  }

  private staleTtlSeconds(ttlSeconds: number): number {
    return Math.max(ttlSeconds * 5, 900)
  }

  async get<T>(prefix: string, id: string): Promise<{ data: T; cachedAt: Date } | null> {
    const key = this.buildKey(prefix, id)
    const raw = await this.redis.get(key)
    if (!raw) return null

    const parsed = JSON.parse(raw) as { data: T; cachedAt: string }
    return { data: parsed.data, cachedAt: new Date(parsed.cachedAt) }
  }

  async set<T>(prefix: string, id: string, data: T, ttlSeconds: number): Promise<void> {
    const key = this.buildKey(prefix, id)
    const staleKey = this.buildStaleKey(prefix, id)
    const payload = JSON.stringify({
      data,
      cachedAt: new Date().toISOString(),
    })
    await this.redis.set(key, payload, 'EX', ttlSeconds)
    await this.redis.set(staleKey, payload, 'EX', this.staleTtlSeconds(ttlSeconds))
  }

  async invalidate(prefix: string, id: string): Promise<void> {
    const key = this.buildKey(prefix, id)
    const staleKey = this.buildStaleKey(prefix, id)
    await this.redis.del(key, staleKey)
  }

  async invalidatePattern(prefix: string): Promise<void> {
    const pattern = this.buildKey(prefix, '*')
    const keys = await this.redis.keys(pattern)
    if (keys.length > 0) {
      await this.redis.del(...keys)
    }
  }

  async getStale<T>(prefix: string, id: string): Promise<T | null> {
    const staleKey = this.buildStaleKey(prefix, id)
    const raw = await this.redis.get(staleKey)
    if (!raw) return null

    const parsed = JSON.parse(raw) as { data: T; cachedAt: string }
    return parsed.data
  }
}

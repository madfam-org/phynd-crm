import type Redis from 'ioredis'

export class CacheManager {
  constructor(
    private readonly redis: Redis,
    private readonly tenantId: string = 'madfam',
  ) {}

  private buildKey(prefix: string, id: string): string {
    return `phyne:${this.tenantId}:${prefix}:${id}`
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
    const payload = JSON.stringify({
      data,
      cachedAt: new Date().toISOString(),
    })
    await this.redis.set(key, payload, 'EX', ttlSeconds)
  }

  async invalidate(prefix: string, id: string): Promise<void> {
    const key = this.buildKey(prefix, id)
    await this.redis.del(key)
  }

  async invalidatePattern(prefix: string): Promise<void> {
    const pattern = this.buildKey(prefix, '*')
    const keys = await this.redis.keys(pattern)
    if (keys.length > 0) {
      await this.redis.del(...keys)
    }
  }

  async getStale<T>(prefix: string, id: string): Promise<T | null> {
    const cached = await this.get<T>(prefix, id)
    return cached?.data ?? null
  }
}

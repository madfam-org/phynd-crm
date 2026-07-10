import { resolveRedisUrl } from '@phynd/config/connections'
import { createLogger } from '@phynd/logging'
import Redis from 'ioredis'

const logger = createLogger('webhook-rate-limiter')

const WINDOW_MS = 60_000 // 1 minute
const MAX_REQUESTS = 100

let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(resolveRedisUrl(), {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    })
  }
  return redis
}

export async function checkRateLimit(ip: string): Promise<{ allowed: boolean; remaining: number }> {
  const key = `phynd:ratelimit:webhook:${ip}`
  const client = getRedis()

  try {
    const current = await client.incr(key)
    if (current === 1) {
      await client.pexpire(key, WINDOW_MS)
    }

    const remaining = Math.max(0, MAX_REQUESTS - current)
    return { allowed: current <= MAX_REQUESTS, remaining }
  } catch (err) {
    logger.warn({ err, ip }, 'Redis webhook rate limiter error — failing closed')
    return { allowed: false, remaining: 0 }
  }
}

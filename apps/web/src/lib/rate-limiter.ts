import { createLogger } from '@phynd/logging'
import Redis from 'ioredis'

const logger = createLogger('rate-limiter')

const DEFAULT_WINDOW_MS = 60_000 // 1 minute
const DEFAULT_MAX_REQUESTS = 200

let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    })
  }
  return redis
}

export async function checkApiRateLimit(
  ip: string,
  opts?: { windowMs?: number; maxRequests?: number },
): Promise<{ allowed: boolean; remaining: number }> {
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS
  const maxRequests = opts?.maxRequests ?? DEFAULT_MAX_REQUESTS
  const key = `phynd:ratelimit:api:${ip}`
  const client = getRedis()

  try {
    const current = await client.incr(key)
    if (current === 1) {
      await client.pexpire(key, windowMs)
    }

    const remaining = Math.max(0, maxRequests - current)
    return { allowed: current <= maxRequests, remaining }
  } catch (err) {
    logger.warn({ err, ip }, 'Redis rate limiter error — failing closed')
    return { allowed: false, remaining: 0 }
  }
}

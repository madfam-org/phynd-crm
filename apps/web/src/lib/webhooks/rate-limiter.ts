import Redis from 'ioredis'

const WINDOW_MS = 60_000 // 1 minute
const MAX_REQUESTS = 100

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

export async function checkRateLimit(ip: string): Promise<{ allowed: boolean; remaining: number }> {
  const key = `phyne:ratelimit:webhook:${ip}`
  const client = getRedis()

  try {
    const current = await client.incr(key)
    if (current === 1) {
      await client.pexpire(key, WINDOW_MS)
    }

    const remaining = Math.max(0, MAX_REQUESTS - current)
    return { allowed: current <= MAX_REQUESTS, remaining }
  } catch {
    // If Redis is down, allow the request (fail open for webhooks)
    return { allowed: true, remaining: MAX_REQUESTS }
  }
}

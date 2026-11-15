import { resolveRedisUrl } from '@phynd/config/connections'
import { createLogger } from '@phynd/logging'
import Redis from 'ioredis'

const logger = createLogger('rate-limiter')

const DEFAULT_WINDOW_MS = 60_000 // 1 minute
const DEFAULT_MAX_REQUESTS = 200

/**
 * Where a key lives: `phynd:ratelimit:<namespace>:<key>`. `api` (the default)
 * is keyed by a caller-supplied address, so any string can reach it; a
 * namespace of its own keeps a bucket out of reach of every address-keyed
 * caller (the MCP keys its client bucket by the verified client id).
 */
export type RateLimitNamespace = 'api' | 'mcp-client' | 'mcp-address'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  /** Milliseconds until the window resets (the whole window when unknown). */
  retryAfterMs: number
  /** True when the limiter backend failed: refused (fail closed), but not the caller's fault. */
  unavailable: boolean
}

/**
 * One round trip, atomic: count the request, and give the key its window when
 * it is new OR has no expiry (a key left without one by any earlier failure
 * heals here instead of refusing its caller forever). Returns the count and
 * the remaining time to live in milliseconds.
 */
export const INCR_WITH_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`

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

export async function checkApiRateLimit(
  ip: string,
  opts?: { windowMs?: number; maxRequests?: number; namespace?: RateLimitNamespace },
): Promise<RateLimitResult> {
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS
  const maxRequests = opts?.maxRequests ?? DEFAULT_MAX_REQUESTS
  const namespace = opts?.namespace ?? 'api'
  const key = `phynd:ratelimit:${namespace}:${ip}`
  const client = getRedis()

  try {
    const reply = (await client.eval(INCR_WITH_WINDOW_SCRIPT, 1, key, windowMs)) as unknown
    const [current, ttl] = Array.isArray(reply) ? reply.map(Number) : []
    if (current === undefined || !Number.isFinite(current)) {
      throw new Error('unexpected rate limiter reply')
    }
    const remaining = Math.max(0, maxRequests - current)
    const retryAfterMs = ttl !== undefined && ttl > 0 ? Math.min(ttl, windowMs) : windowMs
    return { allowed: current <= maxRequests, remaining, retryAfterMs, unavailable: false }
  } catch (err) {
    logger.warn({ err, ip, namespace }, 'Redis rate limiter error — failing closed')
    return { allowed: false, remaining: 0, retryAfterMs: windowMs, unavailable: true }
  }
}

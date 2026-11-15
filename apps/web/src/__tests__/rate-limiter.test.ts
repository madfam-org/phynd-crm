import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ioredis', () => {
  const mockRedis = {
    eval: vi.fn(),
  }
  return { default: vi.fn(() => mockRedis), __mockInstance: mockRedis }
})

vi.mock('@phynd/logging', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}))

interface MockRedis {
  eval: ReturnType<typeof vi.fn>
}

async function getMockRedis(): Promise<MockRedis> {
  const mod = (await import('ioredis')) as unknown as {
    __mockInstance: MockRedis
  }
  return mod.__mockInstance
}

/**
 * An in-memory Redis that answers the limiter's one call with what the Lua
 * script does (INCR; PEXPIRE when the count is 1 or the key has no TTL; reply
 * count and PTTL). The script text itself runs only against a real Redis.
 */
function memoryRedis(mock: MockRedis) {
  const store = new Map<string, { count: number; ttlMs: number | null }>()
  mock.eval.mockImplementation(
    async (_script: string, _keys: number, key: string, windowMs: number) => {
      const entry = store.get(key) ?? { count: 0, ttlMs: null }
      entry.count += 1
      if (entry.count === 1 || entry.ttlMs === null) entry.ttlMs = Number(windowMs)
      store.set(key, entry)
      return [entry.count, entry.ttlMs]
    },
  )
  return store
}

describe('checkApiRateLimit', () => {
  let mock: MockRedis

  beforeEach(async () => {
    mock = await getMockRedis()
    mock.eval.mockReset()
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('allows requests under the limit', async () => {
    mock.eval.mockResolvedValue([1, 60_000])

    const { checkApiRateLimit } = await import('@/lib/rate-limiter')
    const result = await checkApiRateLimit('127.0.0.1')

    expect(result).toEqual({
      allowed: true,
      remaining: 199,
      retryAfterMs: 60_000,
      unavailable: false,
    })
  })

  it('denies requests over the limit, with the time left in the window', async () => {
    mock.eval.mockResolvedValue([201, 12_345])

    const { checkApiRateLimit } = await import('@/lib/rate-limiter')
    const result = await checkApiRateLimit('127.0.0.1')

    expect(result).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 12_345,
      unavailable: false,
    })
  })

  it('counts and sets the expiry in ONE atomic call (no separate pexpire)', async () => {
    mock.eval.mockResolvedValue([1, 60_000])
    const { INCR_WITH_WINDOW_SCRIPT, checkApiRateLimit } = await import('@/lib/rate-limiter')
    await checkApiRateLimit('127.0.0.1', { windowMs: 30_000 })
    expect(mock.eval).toHaveBeenCalledTimes(1)
    expect(mock.eval).toHaveBeenCalledWith(
      INCR_WITH_WINDOW_SCRIPT,
      1,
      'phynd:ratelimit:api:127.0.0.1',
      30_000,
    )
  })

  it('the script sets the expiry when the key is new OR has no TTL (self-healing)', async () => {
    const { INCR_WITH_WINDOW_SCRIPT } = await import('@/lib/rate-limiter')
    const script = INCR_WITH_WINDOW_SCRIPT.replace(/\s+/g, ' ')
    expect(script).toContain("local count = redis.call('INCR', KEYS[1])")
    expect(script).toContain("local ttl = redis.call('PTTL', KEYS[1])")
    expect(script).toContain(
      "if count == 1 or ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1])",
    )
    expect(script).toContain('return {count, ttl}')
  })

  it('a key left without an expiry gets one on the next request', async () => {
    const store = memoryRedis(mock)
    // A key an earlier failure left counting with no expiry.
    store.set('phynd:ratelimit:api:203.0.113.7', { count: 500, ttlMs: null })
    const { checkApiRateLimit } = await import('@/lib/rate-limiter')
    const result = await checkApiRateLimit('203.0.113.7')
    expect(store.get('phynd:ratelimit:api:203.0.113.7')?.ttlMs).toBe(60_000)
    expect(result).toMatchObject({ allowed: false, retryAfterMs: 60_000 })
  })

  it('an address-keyed caller sending `mcp:<clientId>` never touches the MCP client bucket', async () => {
    const store = memoryRedis(mock)
    const { checkApiRateLimit } = await import('@/lib/rate-limiter')
    for (let i = 0; i < 5; i += 1) await checkApiRateLimit('mcp:jnc_reader')
    for (let i = 0; i < 5; i += 1)
      await checkApiRateLimit('jnc_reader', { namespace: 'mcp-client' })
    expect(store.get('phynd:ratelimit:mcp-client:jnc_reader')?.count).toBe(5)
    expect(store.get('phynd:ratelimit:api:mcp:jnc_reader')?.count).toBe(5)
    // No address-keyed string reaches another namespace: the `api:` prefix is fixed.
    for (const key of store.keys()) {
      expect(key.startsWith('phynd:ratelimit:api:') || !key.includes('mcp:jnc_reader')).toBe(true)
    }
  })

  it('fails closed when Redis throws, and says the backend failed', async () => {
    mock.eval.mockRejectedValue(new Error('ECONNREFUSED'))

    const { checkApiRateLimit } = await import('@/lib/rate-limiter')
    const result = await checkApiRateLimit('127.0.0.1')

    expect(result).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 60_000,
      unavailable: true,
    })
  })

  it('fails closed on a reply it cannot read', async () => {
    mock.eval.mockResolvedValue('OK')
    const { checkApiRateLimit } = await import('@/lib/rate-limiter')
    expect(await checkApiRateLimit('127.0.0.1')).toMatchObject({
      allowed: false,
      unavailable: true,
    })
  })
})

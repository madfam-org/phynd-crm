import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('ioredis', () => {
  const mockRedis = {
    incr: vi.fn(),
    pexpire: vi.fn(),
  }
  return { default: vi.fn(() => mockRedis), __mockInstance: mockRedis }
})

vi.mock('@phynd/logging', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}))

interface MockRedis {
  incr: ReturnType<typeof vi.fn>
  pexpire: ReturnType<typeof vi.fn>
}

async function getMockRedis(): Promise<MockRedis> {
  const mod = (await import('ioredis')) as unknown as {
    __mockInstance: MockRedis
  }
  return mod.__mockInstance
}

describe('checkApiRateLimit', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('allows requests under the limit', async () => {
    const mock = await getMockRedis()
    mock.incr.mockResolvedValue(1)
    mock.pexpire.mockResolvedValue(1)

    const { checkApiRateLimit } = await import('@/lib/rate-limiter')
    const result = await checkApiRateLimit('127.0.0.1')

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(199)
  })

  it('denies requests over the limit', async () => {
    const mock = await getMockRedis()
    mock.incr.mockResolvedValue(201)

    const { checkApiRateLimit } = await import('@/lib/rate-limiter')
    const result = await checkApiRateLimit('127.0.0.1')

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('fails closed when Redis throws', async () => {
    const mock = await getMockRedis()
    mock.incr.mockRejectedValue(new Error('ECONNREFUSED'))

    const { checkApiRateLimit } = await import('@/lib/rate-limiter')
    const result = await checkApiRateLimit('127.0.0.1')

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })
})

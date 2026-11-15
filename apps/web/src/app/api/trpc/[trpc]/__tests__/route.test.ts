import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rateMock, handlerMock } = vi.hoisted(() => ({
  rateMock: vi.fn(),
  handlerMock: vi.fn(),
}))

vi.mock('@/lib/rate-limiter', () => ({ checkApiRateLimit: rateMock }))
vi.mock('@/lib/trpc/request-context', () => ({ createAppContextFromRequest: vi.fn() }))
vi.mock('@phynd/api/router', () => ({ appRouter: {} }))
vi.mock('@trpc/server/adapters/fetch', () => ({ fetchRequestHandler: handlerMock }))

import { GET } from '../route'

function request(headers: Record<string, string>) {
  return new Request('http://localhost/api/trpc/contacts.list', { method: 'GET', headers })
}

describe('tRPC route rate-limit key', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateMock.mockResolvedValue({ allowed: true, remaining: 199 })
    handlerMock.mockResolvedValue(new Response('{}', { status: 200 }))
  })

  it('keys the limiter by the edge-set address, not the first x-forwarded-for entry', async () => {
    await GET(
      request({
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '192.0.2.250, 198.51.100.4',
      }),
    )
    expect(rateMock).toHaveBeenCalledWith('203.0.113.7')
  })

  it('without the edge header, keys by the last x-forwarded-for entry', async () => {
    await GET(request({ 'x-forwarded-for': '192.0.2.250, 198.51.100.4' }))
    expect(rateMock).toHaveBeenCalledWith('198.51.100.4')
    expect(rateMock).not.toHaveBeenCalledWith('192.0.2.250')
  })

  it('limits under the trusted address and refuses with 429', async () => {
    rateMock.mockResolvedValue({ allowed: false, remaining: 0 })
    const res = await GET(request({ 'x-forwarded-for': '192.0.2.250, 198.51.100.4' }))
    expect(res.status).toBe(429)
    expect(rateMock).toHaveBeenCalledWith('198.51.100.4')
    expect(handlerMock).not.toHaveBeenCalled()
  })

  it('without any address header, keys by the fixed fallback', async () => {
    await GET(request({}))
    expect(rateMock).toHaveBeenCalledWith('unknown')
  })
})

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cookieSet, seedDemoTenant } = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  seedDemoTenant: vi.fn(() => Promise.resolve()),
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSet }),
}))

vi.mock('@/lib/demo-seed', () => ({ seedDemoTenant }))

import { isDemoSession } from '@/lib/demo'
import { GET } from '../route'

const ORIGINAL = process.env.PHYND_DEMO_ENABLED

function demoRequest() {
  return new NextRequest('https://phynd.app/demo', { headers: { host: 'phynd.app' } })
}

beforeEach(() => {
  cookieSet.mockClear()
  seedDemoTenant.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  if (ORIGINAL === undefined) delete process.env.PHYND_DEMO_ENABLED
  else process.env.PHYND_DEMO_ENABLED = ORIGINAL
})

describe('GET /demo', () => {
  it('starts no session where the demo is off', async () => {
    delete process.env.PHYND_DEMO_ENABLED

    const response = await GET(demoRequest())

    expect(response.status).toBe(307)
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/')
    expect(cookieSet).not.toHaveBeenCalled()
    expect(seedDemoTenant).not.toHaveBeenCalled()
  })

  it('issues a session the demo readers accept, seeds it, and opens the dashboard', async () => {
    vi.stubEnv('PHYND_DEMO_ENABLED', 'true')

    const response = await GET(demoRequest())

    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/overview')
    expect(cookieSet).toHaveBeenCalledTimes(1)
    const [name, sessionId, options] = cookieSet.mock.calls[0] as [string, string, object]
    expect(name).toBe('phynd-demo')
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' })
    expect(isDemoSession({ get: () => ({ value: sessionId }) })).toBe(sessionId)
    expect(seedDemoTenant).toHaveBeenCalledWith(sessionId)
  })
})

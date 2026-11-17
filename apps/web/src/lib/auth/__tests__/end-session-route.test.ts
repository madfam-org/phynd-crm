import { GET } from '@/app/api/auth/end-session/route'
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllEnvs())

const request = () =>
  new NextRequest('http://internal:3000/api/auth/end-session', {
    headers: { host: 'crm.madfam.io', 'x-forwarded-proto': 'https' },
  })

describe('GET /api/auth/end-session', () => {
  it('answers Janua end-session for the public CRM origin', async () => {
    vi.stubEnv('AUTH_JANUA_ISSUER', 'https://auth.example.test')
    vi.stubEnv('AUTH_JANUA_CLIENT_ID', 'synthetic-client-id')
    const response = GET(request())
    expect(response.headers.get('cache-control')).toBe('no-store')
    const target = new URL(((await response.json()) as { redirect_to: string }).redirect_to)
    expect(target.pathname).toBe('/logout')
    expect(target.searchParams.get('post_logout_redirect_uri')).toBe('https://crm.madfam.io/')
  })

  it('falls back to /login without Janua configuration', async () => {
    vi.stubEnv('AUTH_JANUA_ISSUER', '')
    vi.stubEnv('AUTH_JANUA_CLIENT_ID', '')
    expect(await GET(request()).json()).toEqual({ redirect_to: '/login' })
  })
})

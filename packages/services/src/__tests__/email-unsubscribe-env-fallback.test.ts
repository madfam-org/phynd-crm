import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type UnsubscribeModule = typeof import('../email/unsubscribe-token')

async function loadUnsubscribeModule() {
  vi.resetModules()
  return (await import('../email/unsubscribe-token')) as UnsubscribeModule
}

describe('unsubscribe-token env fallback behavior', () => {
  const originalUnsubscribeSecret = process.env.UNSUBSCRIBE_SECRET
  const originalAuthSecret = process.env.AUTH_SECRET

  beforeEach(() => {
    delete process.env.UNSUBSCRIBE_SECRET
    delete process.env.AUTH_SECRET
  })

  afterEach(() => {
    process.env.UNSUBSCRIBE_SECRET = originalUnsubscribeSecret
    process.env.AUTH_SECRET = originalAuthSecret
  })

  it('uses UNSUBSCRIBE_SECRET when set', async () => {
    process.env.UNSUBSCRIBE_SECRET = 'explicit-secret'
    process.env.AUTH_SECRET = 'fallback-secret'
    const { generateUnsubscribeToken } = await loadUnsubscribeModule()

    const explicit = generateUnsubscribeToken('lead-123')
    const fallbackFromAuth = await (async () => {
      delete process.env.UNSUBSCRIBE_SECRET
      const { generateUnsubscribeToken: generateFromAuth } = await loadUnsubscribeModule()
      return generateFromAuth('lead-123')
    })()

    expect(explicit).not.toBe(fallbackFromAuth)
  })

  it('falls back to AUTH_SECRET when UNSUBSCRIBE_SECRET is missing', async () => {
    process.env.AUTH_SECRET = 'auth-only-secret'
    const { generateUnsubscribeToken } = await loadUnsubscribeModule()

    const token = generateUnsubscribeToken('lead-456')
    expect(token).toContain('lead-456.')
    expect(token).toHaveLength('lead-456.'.length + 16)
  })
})

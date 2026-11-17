import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const signIn = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())
vi.mock('next-auth/react', () => ({ signIn, signOut }))

import { endSession, switchAccount } from '../client-session'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  signOut.mockResolvedValue(undefined)
  signIn.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('sign out', () => {
  it('clears the CRM session, then visits Janua end-session', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ redirect_to: 'https://auth.example.test/logout?client_id=x' }),
    })
    const navigate = vi.fn()
    await endSession(navigate)
    expect(signOut).toHaveBeenCalledWith({ redirect: false })
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/end-session', { cache: 'no-store' })
    expect(signOut.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0] ?? 0,
    )
    expect(navigate).toHaveBeenCalledWith('https://auth.example.test/logout?client_id=x')
  })

  it('lands on /login when the end-session URL cannot be read', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const navigate = vi.fn()
    await endSession(navigate)
    expect(navigate).toHaveBeenCalledWith('/login')
  })
})

describe('switch account', () => {
  it('signs in through Janua with the account chooser prompt', async () => {
    await switchAccount('/leads')
    expect(signOut).toHaveBeenCalledWith({ redirect: false })
    expect(signIn).toHaveBeenCalledWith(
      'janua',
      { redirectTo: '/leads' },
      { prompt: 'select_account login' },
    )
  })
})

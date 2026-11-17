import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const authSignIn = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ signIn: authSignIn }))
vi.mock('next-auth/react', () => ({ signIn: vi.fn(), signOut: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/leads' }))

import { signInWithAnotherAccount, signInWithJanua } from '@/app/(auth)/login/actions'
import { AccountMenu } from '@/components/layout/account-menu'
import { NoCrmAccess } from '../no-crm-access'

afterEach(() => vi.clearAllMocks())

describe('login actions', () => {
  it('keeps silent SSO for «Sign in with Janua»', async () => {
    await signInWithJanua('/leads')
    expect(authSignIn).toHaveBeenCalledWith('janua', { redirectTo: '/leads' })
  })

  it('asks Janua for the account chooser for «Use another account»', async () => {
    await signInWithAnotherAccount('/clients')
    expect(authSignIn).toHaveBeenCalledWith(
      'janua',
      { redirectTo: '/clients' },
      { prompt: 'select_account login' },
    )
  })
})

describe('no CRM access screen', () => {
  it('signs out through the new end-session flow and offers another account', () => {
    const html = renderToStaticMarkup(<NoCrmAccess email="person@example.test" />)
    expect(html).not.toContain('/api/auth/signout')
    expect(html).toContain('Use another account')
    expect(html).toContain('Sign out')
  })
})

describe('account menu', () => {
  it('shows who is signed in on the trigger', () => {
    const html = renderToStaticMarkup(<AccountMenu name="Person" email="person@example.test" />)
    expect(html).toContain('person@example.test')
    expect(html).toContain('aria-label="Account: person@example.test"')
  })
})

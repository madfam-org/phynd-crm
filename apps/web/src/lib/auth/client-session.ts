'use client'

import { signIn, signOut } from 'next-auth/react'
import { SWITCH_ACCOUNT_PROMPT } from './janua-logout'

/**
 * Sign out of the CRM AND of Janua: next-auth clears the CRM session, then the
 * browser visits Janua's end-session endpoint (or /login if Janua is not
 * configured), so the next «Sign in with Janua» asks which account to use.
 */
export async function endSession(navigate: (url: string) => void = (url) => window.location.assign(url)) {
  await signOut({ redirect: false })
  let target = '/login'
  try {
    const response = await fetch('/api/auth/end-session', { cache: 'no-store' })
    if (response.ok) {
      const body = (await response.json()) as { redirect_to?: unknown }
      if (typeof body.redirect_to === 'string' && body.redirect_to) target = body.redirect_to
    }
  } catch {
    /* The CRM session is already cleared; /login is the safe landing. */
  }
  navigate(target)
}

/**
 * Switch account: clear the CRM session and sign in again through Janua's
 * account chooser. The Janua session is kept on purpose, so the chooser can
 * still list the account being left; Janua's post-logout redirect only returns
 * to the origin root, which could not carry the chooser request.
 */
export async function switchAccount(redirectTo: string) {
  await signOut({ redirect: false })
  await signIn('janua', { redirectTo }, { prompt: SWITCH_ACCOUNT_PROMPT })
}

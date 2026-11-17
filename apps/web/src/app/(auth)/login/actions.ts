'use server'

import { signIn } from '@/lib/auth'
import { SWITCH_ACCOUNT_PROMPT } from '@/lib/auth/janua-logout'
import { safeNextPath } from '@/lib/http/safe-next'

/** «Sign in with Janua»: silent when the Janua session is still alive (SSO). */
export async function signInWithJanua(next: string | undefined) {
  await signIn('janua', { redirectTo: safeNextPath(next) })
}

/** «Use another account»: Janua's account chooser instead of the silent session. */
export async function signInWithAnotherAccount(next: string | undefined) {
  await signIn('janua', { redirectTo: safeNextPath(next) }, { prompt: SWITCH_ACCOUNT_PROMPT })
}

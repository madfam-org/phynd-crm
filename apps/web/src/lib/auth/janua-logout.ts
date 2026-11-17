/**
 * Janua RP-initiated logout (OIDC end-session).
 *
 * Signing out of the CRM alone (next-auth `signOut`) leaves the Janua SSO
 * session alive, so the next «Sign in with Janua» completes silently with the
 * same account. Ending the Janua session needs a top-level visit to the
 * issuer's end-session endpoint (`<issuer>/logout`, the discovery document's
 * `end_session_endpoint`) with this client's id and a post-logout redirect
 * Janua accepts: the origin root of a registered callback.
 *
 * Built from configuration only (AUTH_JANUA_ISSUER, AUTH_JANUA_CLIENT_ID) and
 * the request's public origin; null when either is missing or unsafe, and the
 * caller then falls back to the CRM's own /login.
 */

/** Janua's `prompt` for «Switch account» / «Use another account».
 *
 * `select_account` shows Janua's chooser over the accounts this browser holds
 * (and its «Use another account»); a choice returns to /authorize for that
 * account without a prompt. `login` is the spec-allowed companion: a Janua
 * without the chooser still asks for credentials instead of signing in
 * silently. Janua does not restrict either prompt by client.
 */
export const SWITCH_ACCOUNT_PROMPT = 'select_account login'

function isSafeOrigin(url: URL): boolean {
  if (url.username || url.password || url.search || url.hash) return false
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
}

export function januaLogoutUrl({
  issuer,
  clientId,
  origin,
}: {
  issuer: string | undefined
  clientId: string | undefined
  origin: string | undefined
}): string | null {
  if (!issuer?.trim() || !clientId?.trim() || !origin?.trim()) return null
  let issuerUrl: URL
  let originUrl: URL
  try {
    issuerUrl = new URL(issuer.trim())
    originUrl = new URL(origin.trim())
  } catch {
    return null
  }
  if (!isSafeOrigin(issuerUrl) || !isSafeOrigin(originUrl)) return null
  const base = issuerUrl.href.endsWith('/') ? issuerUrl.href : `${issuerUrl.href}/`
  const logout = new URL('logout', base)
  logout.searchParams.set('client_id', clientId.trim())
  logout.searchParams.set('post_logout_redirect_uri', `${originUrl.origin}/`)
  return logout.toString()
}

/** The end-session URL for this deployment's Janua client, or null. */
export function januaLogoutUrlFromEnv(origin: string): string | null {
  return januaLogoutUrl({
    issuer: process.env.AUTH_JANUA_ISSUER,
    clientId: process.env.AUTH_JANUA_CLIENT_ID,
    origin,
  })
}

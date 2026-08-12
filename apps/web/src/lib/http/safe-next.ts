/**
 * Validate a user-supplied post-login destination (`?next=`).
 *
 * Only same-origin absolute paths survive: anything with a scheme, a
 * protocol-relative `//host`, or a backslash variant is an open-redirect
 * vector (CWE-601) and collapses to the fallback. Auth pages are excluded
 * so a crafted `next=/login` can't loop the sign-in flow.
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/overview'): string {
  if (!raw) return fallback
  if (!raw.startsWith('/')) return fallback
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  if (raw.includes('\\')) return fallback
  if (raw.startsWith('/login') || raw.startsWith('/callback') || raw.startsWith('/api/')) {
    return fallback
  }
  return raw
}

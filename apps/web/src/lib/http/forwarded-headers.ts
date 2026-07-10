/**
 * Sanitize proxy-forwarded headers before they reach Auth.js.
 *
 * The production ingress chain (Cloudflare edge → cloudflared → service) can
 * stack `x-forwarded-proto` / `x-forwarded-host` into comma-joined lists
 * ("https,https"). Auth.js v5 builds `new URL()` from these values verbatim,
 * so an unsanitized list throws `TypeError: Invalid URL` from every
 * server-side `auth()` call — which took down all dashboard pages and tRPC
 * procedures on 2026-07-09 while the HTTP `/api/auth/*` routes (already
 * normalized by `normalizeAuthRequest`) kept working.
 *
 * `x-forwarded-for` is intentionally untouched: a comma list is semantically
 * correct there (client, proxy1, proxy2) and consumers already split it.
 */

const SINGLE_VALUE_FORWARDED_HEADERS = [
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-original-host',
  'host',
] as const

/** First non-empty comma-separated token, or null when the value is unusable. */
function firstToken(value: string | null): string | null {
  if (value === null) return null
  const token = value
    .split(',')
    .map((part) => part.trim())
    .find(Boolean)
  return token ?? null
}

/**
 * Returns a copy of `headers` where each single-value forwarded header is
 * reduced to its first non-empty token (deleted entirely when empty), plus a
 * flag indicating whether anything changed.
 */
export function sanitizeForwardedHeaders(headers: Headers): {
  headers: Headers
  changed: boolean
} {
  let changed = false
  const sanitized = new Headers(headers)

  for (const name of SINGLE_VALUE_FORWARDED_HEADERS) {
    const raw = sanitized.get(name)
    if (raw === null) continue
    const token = firstToken(raw)
    if (token === null) {
      sanitized.delete(name)
      changed = true
    } else if (token !== raw) {
      sanitized.set(name, token)
      changed = true
    }
  }

  return { headers: sanitized, changed }
}

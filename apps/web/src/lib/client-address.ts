import { isIP } from 'node:net'

/** The shared key for every request whose address cannot be established. */
export const UNKNOWN_CLIENT_ADDRESS = 'unknown'

/**
 * The caller's address, for rate-limit keys and logs.
 *
 * Only values written by our own infrastructure are trusted: `CF-Connecting-IP`
 * (set by the edge), else the LAST `X-Forwarded-For` entry (appended by the
 * proxy directly in front of the app). Earlier `X-Forwarded-For` entries come
 * from the caller and are never used. A value is accepted only when it parses
 * as an IPv4 or IPv6 address (returned lower-cased); anything else shares
 * {@link UNKNOWN_CLIENT_ADDRESS}.
 */
export function clientAddress(headers: Headers): string {
  const candidates = [
    headers.get('cf-connecting-ip'),
    headers.get('x-forwarded-for')?.split(',').at(-1) ?? null,
  ]
  for (const candidate of candidates) {
    const value = candidate?.trim() ?? ''
    if (value !== '' && isIP(value) !== 0) return value.toLowerCase()
  }
  return UNKNOWN_CLIENT_ADDRESS
}

import { januaLogoutUrlFromEnv } from '@/lib/auth/janua-logout'
import { normalizeAuthRequest } from '@/lib/auth/request'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/auth/end-session → `{ redirect_to }`: where the browser goes after
 * the CRM session is cleared. Janua's end-session URL for this request's public
 * origin, so the Janua SSO session ends too and the next sign-in asks for an
 * account; `/login` when Janua is not configured. Reads configuration only;
 * the CRM session itself is cleared by next-auth's own sign-out first.
 */
export function GET(request: NextRequest) {
  const origin = new URL(normalizeAuthRequest(request).url).origin
  return NextResponse.json(
    { redirect_to: januaLogoutUrlFromEnv(origin) ?? '/login' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

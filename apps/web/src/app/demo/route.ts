import { DEMO_COOKIE_MAX_AGE, DEMO_COOKIE_NAME } from '@/lib/demo'
import { seedDemoTenant } from '@/lib/demo-seed'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const sessionId = crypto.randomUUID()
  const cookieStore = await cookies()

  cookieStore.set(DEMO_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: DEMO_COOKIE_MAX_AGE,
    path: '/',
  })

  // Seed demo data — non-blocking, dashboard handles empty state gracefully
  seedDemoTenant(sessionId).catch(() => {
    // Seed failure is non-fatal — visitor sees empty pages
  })

  // Redirect relative to the request URL. The previous fallback to
  // process.env.NEXTAUTH_URL ?? 'http://localhost:3000' leaked
  // localhost:3000 into the production redirect Location header on
  // phynd.app because NEXTAUTH_URL is no longer set after the
  // Janua migration (NextAuth env var was retired).
  return NextResponse.redirect(new URL('/overview', request.url))
}

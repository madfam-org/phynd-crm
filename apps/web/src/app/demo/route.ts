import { DEMO_COOKIE_MAX_AGE, DEMO_COOKIE_NAME } from '@/lib/demo'
import { seedDemoTenant } from '@/lib/demo-seed'
import { externalUrl } from '@/lib/http/origin'
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

  // Redirect against the trusted external origin. In production the app runs
  // behind Enclii/Cloudflare and request.url can be the upstream pod hostname,
  // which must never leak into public Location headers.
  return NextResponse.redirect(externalUrl('/overview', request))
}

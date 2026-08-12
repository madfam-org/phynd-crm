import { auth } from '@/lib/auth'
import { normalizeHost } from '@/lib/branding/tenant-brand'
import { DEMO_COOKIE_NAME } from '@/lib/demo'
import {
  CANONICAL_PHYND_APP_HOST,
  MARKETING_AUTH_REDIRECT_HOSTS,
  getAuthenticatedAppRootRedirect,
  getCanonicalLoginHost,
  getDormantClientHostRedirect,
} from '@/lib/http/app-host'
import { sanitizeForwardedHeaders } from '@/lib/http/forwarded-headers'
import { applyFrameEmbeddingHeaders } from '@/lib/http/frame-embed'
import { externalUrl } from '@/lib/http/origin'
import type { NextFetchEvent } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'

const publicPaths = ['/', '/login', '/callback', '/demo']
const devBypass = process.env.NODE_ENV !== 'production' && process.env.AUTH_BYPASS === 'true'

/**
 * Pass the (sanitized) request headers downstream so the node runtime —
 * server-side `auth()` in layouts and tRPC context creation — also sees
 * single-value forwarded headers. Without this, a comma-stacked
 * `x-forwarded-proto`/`-host` from the Cloudflare tunnel chain reaches
 * Auth.js's `new URL()` and throws `Invalid URL` on every request
 * (prod incident 2026-07-09).
 */
function nextWithFrameHeaders(pathname: string, requestHeaders: Headers) {
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  applyFrameEmbeddingHeaders(response.headers, pathname)
  return response
}

const authMiddleware = auth((req) => {
  const isLoggedIn = !!req.auth?.user
  const { pathname } = req.nextUrl
  const isPublic =
    publicPaths.includes(pathname) ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    // External-client portal: gated by its own signed cookie, not the
    // Auth.js v5 staff session. /portal/verify exchanges the Janua
    // magic-link token; /portal/[id] and /portal/expired read the
    // resulting cookie themselves.
    pathname.startsWith('/portal')
  const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/callback')
  const hasDemoCookie = !!req.cookies.get(DEMO_COOKIE_NAME)?.value
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const normalizedHost = normalizeHost(host)
  const canonicalLoginHost = getCanonicalLoginHost(host, pathname)

  // Holding redirect: crm.phynd.app has no live tenants yet — browser traffic
  // goes to the MADFAM CRM; /api/* keeps serving. See getDormantClientHostRedirect.
  const dormantHostRedirect = getDormantClientHostRedirect(host, pathname, req.nextUrl.search)
  if (dormantHostRedirect) {
    return NextResponse.redirect(dormantHostRedirect, 301)
  }
  const appRootRedirect = getAuthenticatedAppRootRedirect(host, pathname, isLoggedIn)

  if (pathname.startsWith('/api/auth') && MARKETING_AUTH_REDIRECT_HOSTS.has(normalizedHost)) {
    return NextResponse.redirect(
      new URL(`${pathname}${req.nextUrl.search}`, `https://${CANONICAL_PHYND_APP_HOST}`),
    )
  }

  if (canonicalLoginHost) {
    return NextResponse.redirect(
      new URL(`${pathname}${req.nextUrl.search}`, `https://${canonicalLoginHost}`),
    )
  }

  if (appRootRedirect) {
    return NextResponse.redirect(externalUrl(appRootRedirect, req))
  }

  // Demo users can access dashboard pages without auth
  if (!isPublic && !isLoggedIn && hasDemoCookie) {
    return nextWithFrameHeaders(pathname, req.headers)
  }

  if (!isPublic && !isLoggedIn && !devBypass) {
    // Carry the intended destination through the auth wall — email deep
    // links (e.g. a lead notification's "Abrir en el CRM") previously
    // landed on /overview after sign-in, losing the record they targeted.
    const next = encodeURIComponent(`${pathname}${req.nextUrl.search}`)
    return NextResponse.redirect(externalUrl(`/login?next=${next}`, req))
  }

  if (isAuthPage && isLoggedIn) {
    return NextResponse.redirect(externalUrl('/overview', req))
  }

  return nextWithFrameHeaders(pathname, req.headers)
})

/**
 * Sanitize proxy-forwarded headers BEFORE Auth.js sees the request. The
 * Auth.js middleware wrapper itself parses `x-forwarded-proto`/`-host`, so
 * the cleanup must happen outside `auth()` — a comma-joined value would
 * otherwise throw before our callback ever runs.
 */
export default function middleware(req: NextRequest, event: NextFetchEvent) {
  const { headers, changed } = sanitizeForwardedHeaders(req.headers)
  const target = changed ? new NextRequest(req.url, { headers, method: req.method }) : req
  // Auth.js types its wrapped middleware context as AppRouteHandlerFnContext
  // (a superset of NextFetchEvent whose extra `params` is unused in
  // middleware); Next invokes it with a NextFetchEvent at runtime.
  return authMiddleware(
    target as Parameters<typeof authMiddleware>[0],
    event as unknown as Parameters<typeof authMiddleware>[1],
  )
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

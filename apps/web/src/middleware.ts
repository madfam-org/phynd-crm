import { normalizeHost } from '@/lib/branding/tenant-brand'
import { auth } from '@/lib/auth'
import { DEMO_COOKIE_NAME } from '@/lib/demo'
import {
  CANONICAL_PHYND_APP_HOST,
  getAuthenticatedAppRootRedirect,
  getCanonicalLoginHost,
  MARKETING_AUTH_REDIRECT_HOSTS,
} from '@/lib/http/app-host'
import { applyFrameEmbeddingHeaders } from '@/lib/http/frame-embed'
import { externalUrl } from '@/lib/http/origin'
import { NextResponse } from 'next/server'

const publicPaths = ['/', '/login', '/callback', '/demo']
const devBypass = process.env.NODE_ENV !== 'production' && process.env.AUTH_BYPASS === 'true'

function nextWithFrameHeaders(pathname: string) {
  const response = NextResponse.next()
  applyFrameEmbeddingHeaders(response.headers, pathname)
  return response
}

export default auth((req) => {
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
  const appRootRedirect = getAuthenticatedAppRootRedirect(host, pathname, isLoggedIn)

  if (
    pathname.startsWith('/api/auth') &&
    MARKETING_AUTH_REDIRECT_HOSTS.has(normalizedHost)
  ) {
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
    return nextWithFrameHeaders(pathname)
  }

  if (!isPublic && !isLoggedIn && !devBypass) {
    return NextResponse.redirect(externalUrl('/login', req))
  }

  if (isAuthPage && isLoggedIn) {
    return NextResponse.redirect(externalUrl('/overview', req))
  }

  return nextWithFrameHeaders(pathname)
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

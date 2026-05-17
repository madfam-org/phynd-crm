import { auth } from '@/lib/auth'
import { DEMO_COOKIE_NAME } from '@/lib/demo'
import { getAuthenticatedAppRootRedirect } from '@/lib/http/app-host'
import { externalUrl } from '@/lib/http/origin'
import { NextResponse } from 'next/server'

const publicPaths = ['/', '/login', '/callback', '/demo']
const devBypass = process.env.NODE_ENV !== 'production' && process.env.AUTH_BYPASS === 'true'

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
  const appRootRedirect = getAuthenticatedAppRootRedirect(host, pathname, isLoggedIn)

  if (appRootRedirect) {
    return NextResponse.redirect(externalUrl(appRootRedirect, req))
  }

  // Demo users can access dashboard pages without auth
  if (!isPublic && !isLoggedIn && hasDemoCookie) {
    return NextResponse.next()
  }

  if (!isPublic && !isLoggedIn && !devBypass) {
    return NextResponse.redirect(externalUrl('/login', req))
  }

  if (isAuthPage && isLoggedIn) {
    return NextResponse.redirect(externalUrl('/overview', req))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

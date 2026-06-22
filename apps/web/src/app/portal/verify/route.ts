import { setPortalSession } from '@/lib/portal/session'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { EngagementPortalMagicLinkService } from '@phynd/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:portal-verify')

// Magic-link landing: client clicks the link in the email, lands here
// with ?engagement=<id>&token=<janua_token>. We exchange the token with
// Janua, confirm the verified email matches the engagement's contact
// email, seal the session cookie, and redirect to the portal page.
//
// Failure cases all redirect to /portal/expired with a short reason
// code — never leak Janua error details to the client browser.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const engagementId = url.searchParams.get('engagement')
  const token = url.searchParams.get('token')

  if (!engagementId || !token) {
    return NextResponse.redirect(new URL('/portal/expired?reason=missing-params', url), 302)
  }

  try {
    const db = getDb()
    const service = new EngagementPortalMagicLinkService({
      db,
      // biome-ignore lint/suspicious/noExplicitAny: portal verify runs anon
      cache: {} as any,
      auth: {
        userId: 'anon:portal',
        tenantId: 'madfam',
        roles: [],
        scopes: [],
        accessToken: '',
      },
      tenantId: 'madfam',
    })

    const session = await service.verifyPortalLink({ token, engagementId })

    await setPortalSession(
      {
        engagementId,
        email: session.email,
        januaUserId: session.januaUserId,
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
      },
      session.refreshToken,
    )

    return NextResponse.redirect(new URL(`/portal/${encodeURIComponent(engagementId)}`, url), 302)
  } catch (err) {
    logger.warn({ err, engagementId }, 'portal verify failed')
    const reason =
      typeof err === 'object' && err !== null && 'code' in err
        ? ((err as { code?: string }).code ?? 'invalid')
        : 'invalid'
    return NextResponse.redirect(
      new URL(`/portal/expired?reason=${encodeURIComponent(String(reason))}`, url),
      302,
    )
  }
}

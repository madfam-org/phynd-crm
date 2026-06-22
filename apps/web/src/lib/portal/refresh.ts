import { getDb } from '@phynd/db'
import { EngagementPortalMagicLinkService } from '@phynd/services'
import {
  portalSessionNeedsRefresh,
  readAndVerifyPortalSession,
  readPortalRefreshToken,
  readPortalSession,
  setPortalSession,
} from './session'

function portalServiceContext() {
  return {
    db: getDb(),
    // biome-ignore lint/suspicious/noExplicitAny: portal refresh runs without staff ctx
    cache: {} as any,
    auth: {
      userId: 'anon:portal-refresh',
      tenantId: 'madfam',
      roles: ['portal'],
      scopes: ['engagements:read'],
      accessToken: '',
    },
    tenantId: 'madfam',
  }
}

/**
 * Silently refresh an expiring portal session using the Janua refresh token.
 * Returns the verified session when refresh succeeds or the existing session
 * still has enough TTL. Returns null when no recoverable session exists.
 */
export async function refreshPortalSessionIfNeeded(): Promise<void> {
  const session = (await readAndVerifyPortalSession()) ?? (await readPortalSession())
  if (!session) return
  if (!portalSessionNeedsRefresh(session)) return

  const refreshToken = await readPortalRefreshToken()
  if (!refreshToken) return

  try {
    const service = new EngagementPortalMagicLinkService(portalServiceContext())
    const refreshed = await service.refreshPortalSession(refreshToken)
    if (refreshed.januaUserId !== session.januaUserId) return
    if (refreshed.email !== session.email.toLowerCase().trim()) return

    await setPortalSession(
      {
        engagementId: session.engagementId,
        email: session.email,
        januaUserId: session.januaUserId,
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
      },
      refreshed.refreshToken,
    )
  } catch {
    // Expired refresh tokens fall through — page render will redirect to /portal/expired.
  }
}

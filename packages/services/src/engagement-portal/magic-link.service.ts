import { contacts, engagementContacts, engagements } from '@phynd/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { NotFoundError, ServiceError, ValidationError } from '../errors'
import { resolvePortalAccess } from './portal-access'

// Minimum shape Janua's /api/v1/auth/magic-link/verify returns. We
// accept both nested `tokens` and legacy flat shape — the Janua TS SDK
// handles both.
export interface JanuaMagicLinkVerifyResponse {
  user: {
    id: string
    email: string
    email_verified: boolean
  }
  tokens?: {
    access_token: string
    refresh_token: string
    expires_in: number
    token_type: 'bearer'
  }
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

interface PortalSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  email: string
  januaUserId: string
}

// Portal magic-link flow, Janua-backed:
//   1. Staff triggers sendPortalLink(engagementId) from PhyndCRM.
//   2. Janua sends the email with a URL pointing back at PhyndCRM's
//      /portal/verify?engagement=<id>&token=<janua_magic_token>.
//   3. Client clicks; PhyndCRM /portal/verify calls verifyPortalLink()
//      which exchanges the token with Janua, receives an RS256 JWT,
//      and seals it into a httpOnly cookie scoped to the portal.
//   4. Portal page reads the cookie, validates via JWKS, confirms the
//      session email belongs to a portal-enabled contact of the engagement
//      (its primary contact or an engagement_contacts row with
//      portal_access = true; see portal-access.ts), renders.
//
// This keeps the portal's external-client auth isolated from the
// dashboard Auth.js v5 OIDC staff flow — two distinct audiences, two
// distinct session stores, one Janua source of truth.
export class EngagementPortalMagicLinkService {
  constructor(private readonly ctx: ServiceContext) {}

  private get januaApiUrl(): string {
    const url = process.env.JANUA_API_URL
    if (!url) {
      throw new ServiceError('JANUA_API_URL not configured', 'CONFIGURATION_ERROR', 500)
    }
    return url.replace(/\/$/, '')
  }

  private get portalBaseUrl(): string {
    const base = process.env.PORTAL_BASE_URL ?? process.env.NEXTAUTH_URL
    if (!base) {
      throw new ServiceError(
        'PORTAL_BASE_URL or NEXTAUTH_URL not configured',
        'CONFIGURATION_ERROR',
        500,
      )
    }
    return base.replace(/\/$/, '')
  }

  // Exchange a Janua refresh token for a new access/refresh pair.
  async refreshPortalSession(refreshToken: string): Promise<PortalSession> {
    if (!refreshToken || refreshToken.length < 16) {
      throw new ValidationError('Invalid portal refresh token')
    }

    const resp = await fetch(`${this.januaApiUrl}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new ServiceError(
        `Janua token refresh failed (${resp.status}): ${text || resp.statusText}`,
        'JANUA_ERROR',
        resp.status === 401 ? 401 : 502,
      )
    }

    const data = (await resp.json()) as JanuaMagicLinkVerifyResponse & {
      user?: JanuaMagicLinkVerifyResponse['user']
    }

    const accessToken = data.tokens?.access_token ?? data.access_token
    const nextRefresh = data.tokens?.refresh_token ?? data.refresh_token ?? refreshToken
    const expiresIn = data.tokens?.expires_in ?? data.expires_in ?? 900

    if (!accessToken) {
      throw new ServiceError('Janua did not return a refreshed access token', 'JANUA_ERROR', 502)
    }

    const email = data.user?.email
    const januaUserId = data.user?.id
    if (!email || !januaUserId) {
      throw new ServiceError('Janua refresh response missing user identity', 'JANUA_ERROR', 502)
    }

    return {
      accessToken,
      refreshToken: nextRefresh,
      expiresAt: Date.now() + expiresIn * 1000,
      email: email.toLowerCase().trim(),
      januaUserId,
    }
  }

  // Resolves the target email + redirect URL for the engagement, then
  // asks Janua to send the magic-link email to the client. Returns a
  // neutral "sent" ack — never leaks the email back to the caller.
  // `contactId` picks another portal-enabled contact of the engagement;
  // the default is the engagement's primary contact.
  async sendPortalLink(
    engagementId: string,
    contactId?: string,
  ): Promise<{ sent: true; emailRedacted: string }> {
    const [row] = await this.ctx.db
      .select({
        engagementId: engagements.id,
        primaryContactId: engagements.contactId,
        contactEmail: contacts.email,
      })
      .from(engagements)
      .innerJoin(contacts, eq(engagements.contactId, contacts.id))
      .where(and(eq(engagements.id, engagementId), isNull(engagements.deletedAt)))
      .limit(1)

    if (!row) {
      throw new NotFoundError('Engagement', engagementId)
    }
    const recipientEmail =
      contactId && contactId !== row.primaryContactId
        ? await this.portalContactEmail(engagementId, contactId)
        : row.contactEmail
    if (!recipientEmail) {
      throw new ValidationError('Engagement contact has no email on file')
    }

    const redirectUrl = `${this.portalBaseUrl}/portal/verify?engagement=${encodeURIComponent(engagementId)}`

    const resp = await fetch(`${this.januaApiUrl}/api/v1/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: recipientEmail,
        redirect_url: redirectUrl,
      }),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new ServiceError(
        `Janua magic-link send failed (${resp.status}): ${text || resp.statusText}`,
        'JANUA_ERROR',
        resp.status === 429 ? 429 : 502,
      )
    }

    return { sent: true, emailRedacted: redactEmail(recipientEmail) }
  }

  private async portalContactEmail(engagementId: string, contactId: string) {
    const [row] = await this.ctx.db
      .select({ contactEmail: contacts.email })
      .from(engagementContacts)
      .innerJoin(contacts, eq(engagementContacts.contactId, contacts.id))
      .where(
        and(
          eq(engagementContacts.engagementId, engagementId),
          eq(engagementContacts.contactId, contactId),
          eq(engagementContacts.portalAccess, true),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1)
    if (!row) {
      throw new ValidationError('That contact has no portal access to this engagement')
    }
    return row.contactEmail
  }

  // Exchange the Janua magic-link token for an access/refresh pair
  // scoped to the external-client session. Validates the session email
  // belongs to a portal-enabled contact of the engagement before
  // returning the session to the caller.
  async verifyPortalLink(params: {
    token: string
    engagementId: string
  }): Promise<PortalSession> {
    if (!params.token || params.token.length < 16) {
      throw new ValidationError('Invalid portal token')
    }

    // Look up engagement first so we can early-reject bad engagement
    // IDs before burning the magic-link token on Janua's side.
    const [row] = await this.ctx.db
      .select({
        engagementId: engagements.id,
        contactEmail: contacts.email,
      })
      .from(engagements)
      .innerJoin(contacts, eq(engagements.contactId, contacts.id))
      .where(and(eq(engagements.id, params.engagementId), isNull(engagements.deletedAt)))
      .limit(1)

    if (!row) {
      throw new NotFoundError('Engagement', params.engagementId)
    }

    const resp = await fetch(`${this.januaApiUrl}/api/v1/auth/magic-link/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: params.token }),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new ServiceError(
        `Janua magic-link verify failed (${resp.status}): ${text || resp.statusText}`,
        'JANUA_ERROR',
        resp.status === 400 ? 401 : 502,
      )
    }

    const data = (await resp.json()) as JanuaMagicLinkVerifyResponse

    const verifiedEmail = data.user?.email?.toLowerCase().trim()
    const access = verifiedEmail
      ? await resolvePortalAccess(this.ctx.db, params.engagementId, verifiedEmail)
      : null
    if (!verifiedEmail || access?.status !== 'granted') {
      throw new ServiceError(
        'Portal token email does not match a portal contact of the engagement',
        'AUTHZ_MISMATCH',
        403,
      )
    }

    const accessToken = data.tokens?.access_token ?? data.access_token
    const refreshToken = data.tokens?.refresh_token ?? data.refresh_token
    const expiresIn = data.tokens?.expires_in ?? data.expires_in ?? 900

    if (!accessToken || !refreshToken) {
      throw new ServiceError('Janua did not return expected tokens', 'JANUA_ERROR', 502)
    }

    return {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      email: verifiedEmail,
      januaUserId: data.user.id,
    }
  }
}

function redactEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  if (local.length <= 2) return `${local[0] ?? ''}***@${domain}`
  return `${local.slice(0, 2)}***@${domain}`
}
